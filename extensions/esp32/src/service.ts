import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CrawClawConfig,
  CrawClawPluginApi,
  CrawClawPluginService,
  CrawClawPluginServiceContext,
  PluginLogger,
  PluginRuntime,
} from "../api.js";
import { runFfmpeg, synthesizeSpeech } from "../api.js";
import { extractAssistantTextFromPayloads } from "./agent-output.js";
import { readEsp32PluginConfigFromCrawClawConfig, type Esp32PluginConfig } from "./config.js";
import { Esp32DeviceRegistry, type Esp32DeviceToolCallParams } from "./device-registry.js";
import { Esp32DeviceStore, type StoredEsp32Device } from "./device-store.js";
import { Esp32MqttService } from "./mqtt-service.js";
import { renderEsp32Reply } from "./render.js";
import { setEsp32Service } from "./runtime.js";
import {
  ESP32_CHANNEL_ID,
  type Esp32DeviceCapabilities,
  type Esp32ToolCallResult,
} from "./types.js";
import { Esp32UdpService, type Esp32UdpSessionPublicParams } from "./udp-service.js";

type Esp32TextInput = {
  deviceId: string;
  text: string;
  sessionId?: string;
};

function splitModelRef(
  modelRef: string | undefined,
  runtime: PluginRuntime,
): {
  provider: string;
  model: string;
} {
  const fallback = `${runtime.agent.defaults.provider}/${runtime.agent.defaults.model}`;
  const ref = modelRef?.trim() || fallback;
  const slash = ref.indexOf("/");
  if (slash === -1) {
    return { provider: runtime.agent.defaults.provider, model: ref };
  }
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

function buildSessionId(deviceId: string, explicit?: string): string {
  const raw = explicit?.trim() || `esp32-${deviceId}`;
  return raw.replace(/[^a-z0-9._-]/gi, "-").slice(0, 120) || "esp32";
}

async function transcodeToOpusIfNeeded(params: {
  audioBuffer: Buffer;
  outputFormat?: string;
  fileExtension?: string;
}): Promise<Buffer> {
  if (/opus/i.test(params.outputFormat ?? "") || params.fileExtension === ".opus") {
    return params.audioBuffer;
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-esp32-tts-"));
  const inputPath = path.join(tempDir, `input${params.fileExtension ?? ".audio"}`);
  const outputPath = path.join(tempDir, "output.opus");
  try {
    await writeFile(inputPath, params.audioBuffer);
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-c:a",
      "libopus",
      "-b:a",
      "24k",
      "-ar",
      "16000",
      "-ac",
      "1",
      outputPath,
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export class Esp32ChannelService {
  private readonly registry: Esp32DeviceRegistry;
  private readonly deviceStore: Esp32DeviceStore;
  private readonly udp: Esp32UdpService;
  private readonly mqtt: Esp32MqttService;

  constructor(
    private readonly params: {
      config: Esp32PluginConfig;
      coreConfig: CrawClawConfig;
      runtime: PluginRuntime;
      stateDir: string;
      logger: PluginLogger;
    },
  ) {
    this.deviceStore = new Esp32DeviceStore(params.stateDir);
    this.udp = new Esp32UdpService(params.config.udp);
    this.registry = new Esp32DeviceRegistry({
      publish: (deviceId, payload) => this.mqtt.publish(deviceId, payload),
    });
    this.mqtt = new Esp32MqttService({
      config: params.config.broker,
      stateDir: params.stateDir,
      service: this,
      logger: params.logger,
    });
  }

  async start(): Promise<void> {
    await this.udp.start();
    await this.mqtt.start();
    setEsp32Service(this);
    this.params.logger.info(
      `[esp32] MQTT ${this.params.config.broker.bindHost}:${this.params.config.broker.port}, UDP ${this.params.config.udp.bindHost}:${this.params.config.udp.port}`,
    );
  }

  async stop(): Promise<void> {
    await this.mqtt.stop();
    await this.udp.stop();
    setEsp32Service(null);
  }

  registerOnlineDevice(params: { deviceId: string; capabilities?: Esp32DeviceCapabilities }): void {
    this.registry.registerDevice(params);
  }

  async persistDeviceProfile(device: StoredEsp32Device): Promise<void> {
    await this.deviceStore.upsert({ ...device, lastSeenAtMs: Date.now() });
  }

  listOnlineDevices() {
    return this.registry.listDevices();
  }

  async listStoredDevices(): Promise<StoredEsp32Device[]> {
    return await this.deviceStore.list();
  }

  ensureUdpSession(deviceId: string): Esp32UdpSessionPublicParams {
    return this.udp.ensureSession(deviceId);
  }

  setUdpEndpoint(deviceId: string, endpoint: { host: string; port: number }): void {
    this.udp.setEndpoint(deviceId, endpoint);
  }

  async callDeviceTool(params: Esp32DeviceToolCallParams): Promise<Esp32ToolCallResult> {
    return await this.registry.callTool(params);
  }

  resolveDeviceToolResult(params: {
    deviceId: string;
    requestId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
  }): boolean {
    return this.registry.resolveToolResult(params);
  }

  async sendDisplayText(params: {
    deviceId: string;
    text: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    this.mqtt.publish(params.deviceId, {
      type: "reply",
      spokenText: params.text,
      displayText: params.text,
      affect: { state: "neutral" },
    });
    return { ok: true };
  }

  async handleTextInput(input: Esp32TextInput): Promise<void> {
    this.mqtt.publish(input.deviceId, {
      type: "state",
      state: "thinking",
      affect: { state: "thinking" },
    });

    const runtime = this.params.runtime;
    const agentId = "default";
    const sessionId = buildSessionId(input.deviceId, input.sessionId);
    const sessionKey = `esp32:${input.deviceId}`;
    const workspaceDir = runtime.agent.resolveAgentWorkspaceDir(this.params.coreConfig, agentId);
    const agentDir = runtime.agent.resolveAgentDir(this.params.coreConfig, agentId);
    const sessionFile = runtime.agent.session.resolveSessionFilePath(sessionId, undefined, {
      agentId,
    });
    const timeoutMs = runtime.agent.resolveAgentTimeoutMs({ cfg: this.params.coreConfig });
    const result = await runtime.agent.runEmbeddedPiAgent({
      sessionId,
      sessionKey,
      agentId,
      messageChannel: ESP32_CHANNEL_ID,
      messageProvider: ESP32_CHANNEL_ID,
      messageTo: input.deviceId,
      senderId: input.deviceId,
      senderName: input.deviceId,
      senderIsOwner: true,
      sessionFile,
      workspaceDir,
      agentDir,
      config: this.params.coreConfig,
      prompt: input.text,
      timeoutMs,
      runId: `esp32:${input.deviceId}:${Date.now()}`,
      trigger: "user",
      extraSystemPrompt:
        "The user is speaking through an ESP32-S3-BOX-3 desktop assistant. Keep the full answer useful in the CrawClaw session; the ESP32 channel will separately render a short spoken summary.",
    });
    const fullText = extractAssistantTextFromPayloads(result.payloads);
    const rendered = await renderEsp32Reply({
      text: fullText || "我处理好了，完整内容已保留在 CrawClaw。",
      renderer: async (prompt) => await this.runRendererModel(prompt),
      config: this.params.config.renderer,
    });
    let audio: { frames?: number; outputFormat?: string } | undefined;
    const speech = await synthesizeSpeech({
      text: rendered.spokenText,
      cfg: this.params.coreConfig,
      agentId,
      channel: ESP32_CHANNEL_ID,
      overrides: { provider: this.params.config.tts.provider },
    });
    if (speech.success && speech.audioBuffer) {
      const opus = await transcodeToOpusIfNeeded({
        audioBuffer: speech.audioBuffer,
        outputFormat: speech.outputFormat,
        fileExtension: speech.fileExtension,
      });
      audio = {
        frames: this.udp.sendAudio(input.deviceId, opus),
        outputFormat: "opus",
      };
    }
    this.mqtt.publish(input.deviceId, {
      type: "reply",
      spokenText: rendered.spokenText,
      displayText: rendered.displayText,
      affect: rendered.affect,
      ...(audio ? { audio } : {}),
    });
  }

  private async runRendererModel(prompt: string): Promise<string> {
    const runtime = this.params.runtime;
    const { provider, model } = splitModelRef(this.params.config.renderer.model, runtime);
    const sessionId = "esp32-renderer";
    const agentId = "default";
    const sessionFile = runtime.agent.session.resolveSessionFilePath(sessionId, undefined, {
      agentId,
    });
    const result = await runtime.agent.runEmbeddedPiAgent({
      sessionId,
      sessionKey: "esp32:renderer",
      agentId,
      messageChannel: ESP32_CHANNEL_ID,
      messageProvider: ESP32_CHANNEL_ID,
      sessionFile,
      workspaceDir: runtime.agent.resolveAgentWorkspaceDir(this.params.coreConfig, agentId),
      agentDir: runtime.agent.resolveAgentDir(this.params.coreConfig, agentId),
      config: this.params.coreConfig,
      prompt,
      provider,
      model,
      disableTools: true,
      verboseLevel: "off",
      timeoutMs: this.params.config.renderer.timeoutMs,
      maxTurns: 1,
      runId: `esp32-renderer:${Date.now()}`,
      trigger: "manual",
    });
    return extractAssistantTextFromPayloads(result.payloads);
  }
}

export function createEsp32ChannelService(api: CrawClawPluginApi): CrawClawPluginService {
  let service: Esp32ChannelService | null = null;
  return {
    id: "esp32-channel",
    async start(ctx: CrawClawPluginServiceContext) {
      const config = readEsp32PluginConfigFromCrawClawConfig(ctx.config);
      service = new Esp32ChannelService({
        config,
        coreConfig: ctx.config,
        runtime: api.runtime,
        stateDir: ctx.stateDir,
        logger: ctx.logger,
      });
      await service.start();
    },
    async stop() {
      await service?.stop();
      service = null;
    },
  };
}
