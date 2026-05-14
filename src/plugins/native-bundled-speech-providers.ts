import { Buffer } from "node:buffer";
import { runCrawClawRuntimeTool } from "../agents/runtime-tools/native.js";
import type {
  SpeechDirectiveTokenParseContext,
  SpeechProviderConfig,
  SpeechProviderOverrides,
} from "../tts/provider-types.js";
import type { SpeechProviderPlugin } from "./types.js";

const QWEN3_TTS_PLUGIN_ID = "qwen3-tts";
const QWEN3_TTS_PROVIDER_ID = "qwen3-tts";
const DEFAULT_PRESET_INSTRUCTIONS = "natural, warm, expressive";

const QWEN3_TTS_BUILTIN_VOICES = [
  "serena",
  "vivian",
  "uncle_fu",
  "ryan",
  "aiden",
  "ono_anna",
  "sohee",
  "eric",
  "dylan",
] as const;

const PRESET_MODELS = [
  "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
  "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
] as const;

const CLONE_MODELS = ["Qwen/Qwen3-TTS-12Hz-0.6B-Base", "Qwen/Qwen3-TTS-12Hz-1.7B-Base"] as const;

type NativeSpeechOptions = {
  rootDir?: string;
};

type Qwen3TtsRuntime = "auto" | "vllm-omni" | "mlx-audio" | "qwen3-tts.cpp" | "qwen-tts" | "cpu";

type ResolvedQwen3TtsRuntime = Exclude<Qwen3TtsRuntime, "auto">;

type SidecarSynthesisResponse = {
  audioBase64: string;
  outputFormat: string;
  fileExtension?: string;
  voiceCompatible?: boolean;
  sampleRate?: number;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function trimToUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value) ?? {})
      .map(([key, raw]) => [key.trim(), trimToUndefined(raw)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
  );
}

function rawQwenConfig(rawConfig: Record<string, unknown>): Record<string, unknown> {
  const providers = record(rawConfig.providers);
  return record(providers?.[QWEN3_TTS_PROVIDER_ID] ?? rawConfig[QWEN3_TTS_PROVIDER_ID]) ?? {};
}

function runtimeDefaults(rawRuntime: unknown): {
  runtime: ResolvedQwen3TtsRuntime;
  baseUrl: string;
  supported: boolean;
} {
  const runtime = trimToUndefined(rawRuntime) as Qwen3TtsRuntime | undefined;
  if (runtime === "mlx-audio") {
    return {
      runtime,
      baseUrl: "http://127.0.0.1:8011",
      supported: process.platform === "darwin" && process.arch === "arm64",
    };
  }
  if (runtime === "vllm-omni") {
    return {
      runtime,
      baseUrl: "http://127.0.0.1:8010",
      supported: process.platform === "linux",
    };
  }
  if (runtime === "qwen3-tts.cpp") {
    return { runtime, baseUrl: "http://127.0.0.1:8012", supported: false };
  }
  if (runtime === "qwen-tts" || runtime === "cpu") {
    return {
      runtime: runtime === "cpu" ? "qwen-tts" : runtime,
      baseUrl: "http://127.0.0.1:8013",
      supported: ["darwin", "linux", "win32"].includes(process.platform),
    };
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    return { runtime: "mlx-audio", baseUrl: "http://127.0.0.1:8011", supported: true };
  }
  return {
    runtime: "qwen-tts",
    baseUrl: "http://127.0.0.1:8013",
    supported: ["darwin", "linux", "win32"].includes(process.platform),
  };
}

function defaultProfiles(raw: Record<string, unknown>): Record<string, unknown> {
  return (
    record(raw.profiles) ?? {
      assistant: {
        source: "preset",
        quality: "balanced",
        voice: "vivian",
        language: "Auto",
        instructions: DEFAULT_PRESET_INSTRUCTIONS,
      },
    }
  );
}

function resolveQwen3TtsProviderConfig(rawConfig: Record<string, unknown>): SpeechProviderConfig {
  const raw = rawQwenConfig(rawConfig);
  const defaults = runtimeDefaults(raw.runtime);
  const experimental = bool(raw.experimental);
  return {
    enabled: bool(raw.enabled),
    experimental,
    runtime: defaults.runtime,
    baseUrl: trimToUndefined(raw.baseUrl) ?? defaults.baseUrl,
    supported: defaults.supported || experimental,
    autoStart: bool(raw.autoStart),
    startupTimeoutMs: positiveInteger(raw.startupTimeoutMs, 30_000),
    healthPath: trimToUndefined(raw.healthPath) ?? "/health",
    defaultProfile: trimToUndefined(raw.defaultProfile) ?? "assistant",
    voiceDirectory: trimToUndefined(raw.voiceDirectory) ?? "~/.crawclaw/voices",
    launchCommand: trimToUndefined(raw.launchCommand),
    launchArgs: Array.isArray(raw.launchArgs)
      ? raw.launchArgs.filter((entry): entry is string => typeof entry === "string")
      : [],
    launchCwd: trimToUndefined(raw.launchCwd),
    agentProfiles: stringRecord(raw.agentProfiles),
    profiles: defaultProfiles(raw),
  };
}

function readOverrides(overrides: SpeechProviderOverrides | undefined): SpeechProviderOverrides {
  return {
    profile: trimToUndefined(overrides?.profile),
    voice: trimToUndefined(overrides?.voice),
    model: trimToUndefined(overrides?.model),
    language: trimToUndefined(overrides?.language),
    instructions: trimToUndefined(overrides?.instructions),
  };
}

function parseDirectiveToken(ctx: SpeechDirectiveTokenParseContext) {
  switch (ctx.key) {
    case "voice":
    case "qwen_voice":
      return { handled: true, overrides: ctx.policy.allowVoice ? { voice: ctx.value } : undefined };
    case "model":
    case "qwen_model":
      return {
        handled: true,
        overrides: ctx.policy.allowModelId ? { model: ctx.value } : undefined,
      };
    case "language":
    case "qwen_language":
      return {
        handled: true,
        overrides: ctx.policy.allowNormalization ? { language: ctx.value } : undefined,
      };
    case "instructions":
    case "qwen_instructions":
      return { handled: true, overrides: { instructions: ctx.value } };
    case "profile":
    case "qwen_profile":
      return { handled: true, overrides: { profile: ctx.value } };
    default:
      return { handled: false };
  }
}

async function synthesizeQwen3Tts(params: {
  text: string;
  agentId?: string;
  providerConfig: SpeechProviderConfig;
  providerOverrides?: SpeechProviderOverrides;
  target: "audio-file" | "voice-note" | "telephony";
  responseFormat: string;
  timeoutMs: number;
  rootDir?: string;
}): Promise<SidecarSynthesisResponse> {
  const input = {
    text: params.text,
    target: params.target,
    responseFormat: params.responseFormat,
    agentId: params.agentId,
    providerConfig: params.providerConfig,
    providerOverrides: readOverrides(params.providerOverrides),
    pluginRoot: params.rootDir,
  };
  await runCrawClawRuntimeTool(
    "native_plugin_service_start",
    {
      pluginId: QWEN3_TTS_PLUGIN_ID,
      serviceId: "qwen3-tts-daemon",
      input: { providerConfig: params.providerConfig, pluginRoot: params.rootDir },
    },
    { timeoutMs: params.timeoutMs },
  );
  return await runCrawClawRuntimeTool<SidecarSynthesisResponse>(
    "native_plugin_invoke",
    {
      pluginId: QWEN3_TTS_PLUGIN_ID,
      operation: "synthesize",
      input,
    },
    { timeoutMs: params.timeoutMs },
  );
}

function qwen3TtsSpeechProvider(options: NativeSpeechOptions = {}): SpeechProviderPlugin {
  return {
    id: QWEN3_TTS_PROVIDER_ID,
    label: "Qwen3-TTS (local)",
    aliases: ["qwen3tts"],
    autoSelectOrder: 5,
    models: [...PRESET_MODELS, ...CLONE_MODELS, "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"],
    voices: [...QWEN3_TTS_BUILTIN_VOICES],
    resolveConfig: ({ rawConfig }) => resolveQwen3TtsProviderConfig(rawConfig),
    parseDirectiveToken,
    isConfigured: ({ providerConfig }) =>
      providerConfig.enabled === true && providerConfig.supported === true,
    synthesize: async ({ text, agentId, providerConfig, providerOverrides, target, timeoutMs }) => {
      const response = await synthesizeQwen3Tts({
        text,
        agentId,
        providerConfig,
        providerOverrides,
        target,
        responseFormat: target === "voice-note" ? "opus" : "wav",
        timeoutMs,
        rootDir: options.rootDir,
      });
      return {
        audioBuffer: Buffer.from(response.audioBase64, "base64"),
        outputFormat: response.outputFormat,
        fileExtension: response.fileExtension ?? `.${response.outputFormat}`,
        voiceCompatible: response.voiceCompatible ?? target === "voice-note",
      };
    },
    synthesizeTelephony: async ({ text, providerConfig, timeoutMs }) => {
      const response = await synthesizeQwen3Tts({
        text,
        providerConfig,
        target: "telephony",
        responseFormat: "pcm",
        timeoutMs,
        rootDir: options.rootDir,
      });
      return {
        audioBuffer: Buffer.from(response.audioBase64, "base64"),
        outputFormat: response.outputFormat,
        sampleRate: response.sampleRate ?? 24_000,
      };
    },
    listVoices: async () =>
      QWEN3_TTS_BUILTIN_VOICES.map((voiceId) => ({
        id: voiceId,
        name: voiceId,
      })),
  };
}

export function nativeBundledSpeechProvidersForPlugin(
  pluginId: string,
  options: NativeSpeechOptions = {},
): SpeechProviderPlugin[] {
  if (pluginId !== QWEN3_TTS_PLUGIN_ID) {
    return [];
  }
  return [qwen3TtsSpeechProvider(options)];
}
