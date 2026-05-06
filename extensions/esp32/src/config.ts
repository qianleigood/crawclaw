import { z } from "zod";
import type { CrawClawConfig, CrawClawPluginConfigSchema } from "../api.js";
import { ESP32_CHANNEL_ID } from "./types.js";

const ManagedBrokerSchema = z.object({
  mode: z.literal("managed").default("managed"),
  bindHost: z.string().default("0.0.0.0"),
  port: z.number().int().min(1).max(65535).default(1883),
  advertisedHost: z.string().optional(),
});

const UdpSchema = z.object({
  bindHost: z.string().default("0.0.0.0"),
  port: z.number().int().min(1).max(65535).default(1884),
  advertisedHost: z.string().optional(),
});

const RendererSchema = z.object({
  model: z.string().optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(8_000),
  maxSpokenChars: z.number().int().min(8).max(200).default(40),
  maxDisplayChars: z.number().int().min(8).max(400).default(72),
});

const TtsSchema = z.object({
  provider: z.string().default("qwen3-tts"),
  target: z.literal("voice-note").default("voice-note"),
});

const ToolsSchema = z.object({
  allowlist: z
    .array(z.string())
    .default(["display.*", "led.*", "audio.*", "volume.*", "mute.*", "sensor.*"]),
  highRiskRequiresApproval: z.boolean().default(true),
});

export const Esp32PluginConfigZodSchema = z.object({
  broker: ManagedBrokerSchema.default(() => ManagedBrokerSchema.parse({})),
  udp: UdpSchema.default(() => UdpSchema.parse({})),
  renderer: RendererSchema.default(() => RendererSchema.parse({})),
  tts: TtsSchema.default(() => TtsSchema.parse({})),
  tools: ToolsSchema.default(() => ToolsSchema.parse({})),
});

export type Esp32PluginConfig = z.infer<typeof Esp32PluginConfigZodSchema>;

export const esp32PluginConfigSchema: CrawClawPluginConfigSchema = {
  parse(value: unknown) {
    return Esp32PluginConfigZodSchema.parse(value ?? {});
  },
  safeParse(value: unknown) {
    const result = Esp32PluginConfigZodSchema.safeParse(value ?? {});
    if (result.success) {
      return result;
    }
    return {
      success: false,
      error: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.filter(
            (entry): entry is string | number =>
              typeof entry === "string" || typeof entry === "number",
          ),
          message: issue.message,
        })),
      },
    };
  },
  uiHints: {
    "broker.bindHost": { label: "MQTT Bind Host", advanced: true },
    "broker.port": { label: "MQTT Port" },
    "broker.advertisedHost": { label: "MQTT Advertised Host" },
    "udp.bindHost": { label: "UDP Bind Host", advanced: true },
    "udp.port": { label: "UDP Port" },
    "udp.advertisedHost": { label: "UDP Advertised Host" },
    "renderer.model": { label: "Renderer Model", advanced: true },
    "renderer.timeoutMs": { label: "Renderer Timeout (ms)", advanced: true },
    "renderer.maxSpokenChars": { label: "Max Spoken Chars" },
    "renderer.maxDisplayChars": { label: "Max Display Chars" },
    "tts.provider": { label: "TTS Provider" },
    "tools.allowlist": { label: "Device Tool Allowlist", advanced: true },
    "tools.highRiskRequiresApproval": {
      label: "Require Approval For High-Risk Tools",
      advanced: true,
    },
  },
};

export function resolveEsp32PluginConfig(raw: unknown): Esp32PluginConfig {
  return Esp32PluginConfigZodSchema.parse(raw ?? {});
}

export function readEsp32PluginConfigFromCrawClawConfig(cfg: CrawClawConfig): Esp32PluginConfig {
  return resolveEsp32PluginConfig(cfg.plugins?.entries?.[ESP32_CHANNEL_ID]?.config);
}

export function isEsp32PluginEnabled(cfg: CrawClawConfig): boolean {
  return cfg.plugins?.entries?.[ESP32_CHANNEL_ID]?.enabled !== false;
}
