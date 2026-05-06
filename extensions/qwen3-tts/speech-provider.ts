import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  SpeechDirectiveTokenParseContext,
  SpeechProviderConfig,
  SpeechProviderOverrides,
  SpeechProviderPlugin,
} from "crawclaw/plugin-sdk/speech";
import { asObject, readResponseTextLimited, trimToUndefined } from "crawclaw/plugin-sdk/speech";
import { resolveManagedQwen3TtsRuntimePython } from "crawclaw/plugin-sdk/state-paths";
import { resolveUserPath } from "crawclaw/plugin-sdk/text-runtime";
import { ensureManagedQwen3TtsDaemon } from "./daemon.js";

export const QWEN3_TTS_PROVIDER_ID = "qwen3-tts";

export const QWEN3_TTS_BUILTIN_VOICES = [
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

const DEFAULT_VOICE_DIRECTORY = "~/.crawclaw/voices";
const DEFAULT_PRESET_INSTRUCTIONS = "natural, warm, expressive";

const PRESET_MODEL_BY_QUALITY = {
  fast: "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
  balanced: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
} as const;

const CLONE_MODEL_BY_QUALITY = {
  "clone-fast": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
  clone: "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
} as const;

const VOICE_DESIGN_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign";

type PlatformInfo = {
  platform: NodeJS.Platform | string;
  arch: string;
};

type Qwen3TtsRuntime = "auto" | "vllm-omni" | "mlx-audio" | "qwen3-tts.cpp" | "qwen-tts" | "cpu";
type ResolvedQwen3TtsRuntime = Exclude<Qwen3TtsRuntime, "auto">;
type Qwen3TtsManagedRuntime = "mlx-audio" | "qwen-tts";
type PresetQuality = keyof typeof PRESET_MODEL_BY_QUALITY;
type CloneQuality = keyof typeof CLONE_MODEL_BY_QUALITY;

type PresetProfile = {
  source: "preset";
  quality: PresetQuality;
  voice: string;
  language?: string;
  instructions?: string;
};

type CloneProfile = {
  source: "clone";
  quality: CloneQuality;
  refAudio: string;
  refText: string;
  language?: string;
  instructions?: string;
};

type DesignProfile = {
  source: "design";
  prompt: string;
  language?: string;
};

type ResolvedQwen3TtsProfile = PresetProfile | CloneProfile | DesignProfile;

export type ResolvedQwen3TtsProviderConfig = {
  enabled: boolean;
  experimental: boolean;
  runtime: ResolvedQwen3TtsRuntime;
  baseUrl: string;
  supported: boolean;
  autoStart: boolean;
  startupTimeoutMs: number;
  healthPath: string;
  managedRuntime: Qwen3TtsManagedRuntime | false;
  launchCommand?: string;
  launchArgs?: string[];
  launchCwd?: string;
  defaultProfile: string;
  voiceDirectory: string;
  agentProfiles: Record<string, string>;
  profiles: Record<string, ResolvedQwen3TtsProfile>;
};

type Qwen3TtsProviderOverrides = {
  profile?: string;
  voice?: string;
  model?: string;
  language?: string;
  instructions?: string;
};

type SidecarSynthesisResponse = {
  audioBase64: string;
  outputFormat: string;
  fileExtension?: string;
  voiceCompatible?: boolean;
  sampleRate?: number;
};

function detectPlatformInfo(): PlatformInfo {
  return { platform: process.platform, arch: process.arch };
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringRecord(value: unknown): Record<string, unknown> {
  return asObject(value) ?? {};
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/u, "");
}

function resolveBundledMlxSidecarScriptPath(): string {
  const candidates = [
    fileURLToPath(new URL("../python/qwen3_tts_sidecar.py", import.meta.url)),
    fileURLToPath(new URL("./python/qwen3_tts_sidecar.py", import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0]!;
}

function resolveBundledPythonSidecarScriptPath(): string {
  const candidates = [
    fileURLToPath(new URL("../python/qwen3_tts_python_sidecar.py", import.meta.url)),
    fileURLToPath(new URL("./python/qwen3_tts_python_sidecar.py", import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0]!;
}

function resolveRuntimeDefaults(
  runtime: Qwen3TtsRuntime,
  platformInfo: PlatformInfo,
): {
  runtime: ResolvedQwen3TtsRuntime;
  baseUrl: string;
  supported: boolean;
} {
  if (runtime === "auto") {
    if (platformInfo.platform === "darwin" && platformInfo.arch === "arm64") {
      return {
        runtime: "mlx-audio",
        baseUrl: "http://127.0.0.1:8011",
        supported: true,
      };
    }
    if (platformInfo.platform === "linux") {
      return {
        runtime: "qwen-tts",
        baseUrl: "http://127.0.0.1:8013",
        supported: true,
      };
    }
    if (platformInfo.platform === "win32") {
      return {
        runtime: "qwen-tts",
        baseUrl: "http://127.0.0.1:8013",
        supported: true,
      };
    }
    return {
      runtime: "qwen-tts",
      baseUrl: "http://127.0.0.1:8013",
      supported: ["darwin", "linux", "win32"].includes(String(platformInfo.platform)),
    };
  }

  switch (runtime) {
    case "mlx-audio":
      return {
        runtime,
        baseUrl: "http://127.0.0.1:8011",
        supported: platformInfo.platform === "darwin" && platformInfo.arch === "arm64",
      };
    case "vllm-omni":
      return {
        runtime,
        baseUrl: "http://127.0.0.1:8010",
        supported: platformInfo.platform === "linux",
      };
    case "qwen3-tts.cpp":
      return {
        runtime,
        baseUrl: "http://127.0.0.1:8012",
        supported: false,
      };
    case "qwen-tts":
      return {
        runtime,
        baseUrl: "http://127.0.0.1:8013",
        supported: ["darwin", "linux", "win32"].includes(String(platformInfo.platform)),
      };
    case "cpu":
      return {
        runtime,
        baseUrl: "http://127.0.0.1:8013",
        supported: ["darwin", "linux", "win32"].includes(String(platformInfo.platform)),
      };
  }
}

function normalizeVoiceDirectory(value: unknown): string {
  return resolveUserPath(trimToUndefined(value) ?? DEFAULT_VOICE_DIRECTORY);
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

function normalizeLaunchArgs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function isPathInside(parentDir: string, childPath: string): boolean {
  const relative = path.relative(parentDir, childPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizeCloneAudioPath(rawPath: unknown, voiceDirectory: string): string {
  const input = trimToUndefined(rawPath);
  if (!input) {
    throw new Error("Qwen3-TTS clone profile requires refAudio");
  }
  const resolved = resolveUserPath(input);
  if (!isPathInside(voiceDirectory, resolved) && resolved !== voiceDirectory) {
    throw new Error(
      `Qwen3-TTS clone reference audio must stay inside ${voiceDirectory}: ${resolved}`,
    );
  }
  return resolved;
}

function resolveDefaultLaunchConfig(params: {
  runtime: ResolvedQwen3TtsRuntime;
  autoStart: boolean;
  baseUrl: string;
  healthPath: string;
  launchCommand?: string;
  launchArgs: string[];
  launchCwd?: string;
}): {
  managedRuntime: Qwen3TtsManagedRuntime | false;
  launchCommand?: string;
  launchArgs: string[];
  launchCwd?: string;
} {
  if (!params.autoStart || params.launchCommand || params.launchArgs.length > 0) {
    return {
      managedRuntime: false,
      launchCommand: params.launchCommand,
      launchArgs: params.launchArgs,
      launchCwd: params.launchCwd,
    };
  }

  const parsedBaseUrl = new URL(params.baseUrl);
  if (params.runtime === "mlx-audio") {
    return {
      managedRuntime: "mlx-audio",
      launchCommand: resolveManagedQwen3TtsRuntimePython(),
      launchArgs: [
        resolveBundledMlxSidecarScriptPath(),
        "--host",
        parsedBaseUrl.hostname,
        "--port",
        parsedBaseUrl.port || "8011",
        "--health-path",
        params.healthPath,
      ],
      launchCwd: params.launchCwd,
    };
  }

  if (params.runtime === "qwen-tts" || params.runtime === "cpu") {
    return {
      managedRuntime: "qwen-tts",
      launchCommand: resolveManagedQwen3TtsRuntimePython(),
      launchArgs: [
        resolveBundledPythonSidecarScriptPath(),
        "--host",
        parsedBaseUrl.hostname,
        "--port",
        parsedBaseUrl.port || "8013",
        "--health-path",
        params.healthPath,
      ],
      launchCwd: params.launchCwd,
    };
  }

  return {
    managedRuntime: false,
    launchArgs: params.launchArgs,
    launchCwd: params.launchCwd,
  };
}

function normalizePresetProfile(rawProfile: Record<string, unknown>): PresetProfile {
  const quality = trimToUndefined(rawProfile.quality);
  return {
    source: "preset",
    quality: quality === "fast" ? "fast" : "balanced",
    voice: trimToUndefined(rawProfile.voice) ?? "vivian",
    language: trimToUndefined(rawProfile.language) ?? "Auto",
    instructions: trimToUndefined(rawProfile.instructions) ?? DEFAULT_PRESET_INSTRUCTIONS,
  };
}

function normalizeCloneProfile(
  rawProfile: Record<string, unknown>,
  voiceDirectory: string,
): CloneProfile {
  const quality = trimToUndefined(rawProfile.quality);
  return {
    source: "clone",
    quality: quality === "clone-fast" ? "clone-fast" : "clone",
    refAudio: normalizeCloneAudioPath(rawProfile.refAudio, voiceDirectory),
    refText: trimToUndefined(rawProfile.refText) ?? "",
    language: trimToUndefined(rawProfile.language) ?? "Auto",
    instructions: trimToUndefined(rawProfile.instructions),
  };
}

function normalizeDesignProfile(rawProfile: Record<string, unknown>): DesignProfile {
  const prompt = trimToUndefined(rawProfile.prompt);
  if (!prompt) {
    throw new Error("Qwen3-TTS design profile requires prompt");
  }
  return {
    source: "design",
    prompt,
    language: trimToUndefined(rawProfile.language) ?? "Auto",
  };
}

function normalizeProfile(
  rawProfile: Record<string, unknown>,
  voiceDirectory: string,
): ResolvedQwen3TtsProfile {
  const source = trimToUndefined(rawProfile.source) ?? "preset";
  if (source === "clone") {
    return normalizeCloneProfile(rawProfile, voiceDirectory);
  }
  if (source === "design") {
    return normalizeDesignProfile(rawProfile);
  }
  return normalizePresetProfile(rawProfile);
}

function normalizeProfiles(
  raw: Record<string, unknown>,
  voiceDirectory: string,
): Record<string, ResolvedQwen3TtsProfile> {
  const rawProfiles = asStringRecord(raw.profiles);
  const normalizedEntries = Object.entries(rawProfiles).map(([profileId, value]) => [
    profileId,
    normalizeProfile(asStringRecord(value), voiceDirectory),
  ]);
  if (normalizedEntries.length === 0) {
    return {
      assistant: normalizePresetProfile({}),
    };
  }
  return Object.fromEntries(normalizedEntries);
}

function readRawQwen3TtsConfig(rawConfig: Record<string, unknown>): Record<string, unknown> {
  const providers = asStringRecord(rawConfig.providers);
  return asStringRecord(providers[QWEN3_TTS_PROVIDER_ID] ?? rawConfig[QWEN3_TTS_PROVIDER_ID]);
}

export function resolveQwen3TtsProviderConfig(
  rawConfig: Record<string, unknown>,
  platformInfo: PlatformInfo = detectPlatformInfo(),
): ResolvedQwen3TtsProviderConfig {
  const raw = readRawQwen3TtsConfig(rawConfig);
  const enabled = asBoolean(raw.enabled, false);
  const experimental = asBoolean(raw.experimental, false);
  const runtimeValue = trimToUndefined(raw.runtime) ?? "auto";
  const runtime = (
    ["auto", "vllm-omni", "mlx-audio", "qwen3-tts.cpp", "qwen-tts", "cpu"] as const
  ).includes(runtimeValue as Qwen3TtsRuntime)
    ? (runtimeValue as Qwen3TtsRuntime)
    : "auto";
  const runtimeDefaults = resolveRuntimeDefaults(runtime, platformInfo);
  const baseUrl = normalizeBaseUrl(trimToUndefined(raw.baseUrl) ?? runtimeDefaults.baseUrl);
  const autoStart = asBoolean(raw.autoStart, false);
  const healthPath = trimToUndefined(raw.healthPath) ?? "/health";
  const launchArgs = normalizeLaunchArgs(raw.launchArgs);
  const launchConfig = resolveDefaultLaunchConfig({
    runtime: runtimeDefaults.runtime,
    autoStart,
    baseUrl,
    healthPath,
    launchCommand: trimToUndefined(raw.launchCommand),
    launchArgs,
    launchCwd: trimToUndefined(raw.launchCwd),
  });
  const voiceDirectory = normalizeVoiceDirectory(raw.voiceDirectory);
  const profiles = normalizeProfiles(raw, voiceDirectory);
  const defaultProfile = trimToUndefined(raw.defaultProfile) ?? "assistant";

  return {
    enabled,
    experimental,
    runtime: runtimeDefaults.runtime,
    baseUrl,
    supported: runtimeDefaults.supported || experimental,
    autoStart,
    startupTimeoutMs: normalizePositiveInteger(raw.startupTimeoutMs, 30_000),
    healthPath,
    managedRuntime: launchConfig.managedRuntime,
    launchCommand: launchConfig.launchCommand,
    launchArgs: launchConfig.launchArgs,
    launchCwd: launchConfig.launchCwd,
    defaultProfile,
    voiceDirectory,
    agentProfiles: normalizeAgentProfiles(raw.agentProfiles),
    profiles,
  };
}

function normalizeAgentProfiles(value: unknown): Record<string, string> {
  const raw = asStringRecord(value);
  const entries: Record<string, string> = {};
  for (const [agentId, profileId] of Object.entries(raw)) {
    const normalizedAgentId = trimToUndefined(agentId);
    const normalizedProfileId = trimToUndefined(profileId);
    if (!normalizedAgentId || !normalizedProfileId) {
      continue;
    }
    entries[normalizedAgentId] = normalizedProfileId;
  }
  return entries;
}

function readProviderConfig(providerConfig: SpeechProviderConfig): ResolvedQwen3TtsProviderConfig {
  const config = providerConfig as Partial<ResolvedQwen3TtsProviderConfig>;
  const managedRuntime = (providerConfig as { managedRuntime?: unknown }).managedRuntime;
  return {
    enabled: config.enabled === true,
    experimental: config.experimental === true,
    runtime: config.runtime ?? "cpu",
    baseUrl: normalizeBaseUrl(config.baseUrl ?? "http://127.0.0.1:8013"),
    supported: config.supported === true,
    autoStart: config.autoStart === true,
    startupTimeoutMs: config.startupTimeoutMs ?? 30_000,
    healthPath: trimToUndefined(config.healthPath) ?? "/health",
    managedRuntime:
      managedRuntime === "mlx-audio" || managedRuntime === "qwen-tts"
        ? managedRuntime
        : managedRuntime === true
          ? "mlx-audio"
          : false,
    launchCommand: trimToUndefined(config.launchCommand),
    launchArgs: Array.isArray(config.launchArgs) ? config.launchArgs : [],
    launchCwd: trimToUndefined(config.launchCwd),
    defaultProfile: trimToUndefined(config.defaultProfile) ?? "assistant",
    voiceDirectory: trimToUndefined(config.voiceDirectory) ?? normalizeVoiceDirectory(undefined),
    agentProfiles: normalizeAgentProfiles(config.agentProfiles),
    profiles: (config.profiles as Record<string, ResolvedQwen3TtsProfile> | undefined) ?? {
      assistant: normalizePresetProfile({}),
    },
  };
}

function readOverrides(overrides: SpeechProviderOverrides | undefined): Qwen3TtsProviderOverrides {
  return {
    profile: trimToUndefined(overrides?.profile),
    voice: trimToUndefined(overrides?.voice),
    model: trimToUndefined(overrides?.model),
    language: trimToUndefined(overrides?.language),
    instructions: trimToUndefined(overrides?.instructions),
  };
}

function resolveProfile(
  config: ResolvedQwen3TtsProviderConfig,
  overrides: Qwen3TtsProviderOverrides,
  agentId?: string,
): ResolvedQwen3TtsProfile {
  const profileId =
    overrides.profile ??
    (agentId ? config.agentProfiles[agentId] : undefined) ??
    config.defaultProfile;
  const profile = config.profiles[profileId];
  if (!profile) {
    throw new Error(`Qwen3-TTS profile "${profileId}" is not defined`);
  }
  return profile;
}

function resolvePresetModel(profile: PresetProfile, overrides: Qwen3TtsProviderOverrides): string {
  return overrides.model ?? PRESET_MODEL_BY_QUALITY[profile.quality];
}

function resolveCloneModel(profile: CloneProfile, overrides: Qwen3TtsProviderOverrides): string {
  return overrides.model ?? CLONE_MODEL_BY_QUALITY[profile.quality];
}

function buildSynthesisPayload(params: {
  text: string;
  config: ResolvedQwen3TtsProviderConfig;
  overrides: Qwen3TtsProviderOverrides;
  agentId?: string;
  responseFormat: string;
}): Record<string, unknown> {
  const profile = resolveProfile(params.config, params.overrides, params.agentId);
  if (profile.source === "preset") {
    return {
      task: "preset",
      text: params.text,
      model: resolvePresetModel(profile, params.overrides),
      voice: params.overrides.voice ?? profile.voice,
      language: params.overrides.language ?? profile.language,
      instructions: params.overrides.instructions ?? profile.instructions,
      responseFormat: params.responseFormat,
      runtime: params.config.runtime,
    };
  }
  if (profile.source === "clone") {
    if (!profile.refText) {
      throw new Error("Qwen3-TTS clone profile requires refText");
    }
    return {
      task: "clone",
      text: params.text,
      model: resolveCloneModel(profile, params.overrides),
      refAudio: profile.refAudio,
      refText: profile.refText,
      language: params.overrides.language ?? profile.language,
      instructions: params.overrides.instructions ?? profile.instructions,
      responseFormat: params.responseFormat,
      runtime: params.config.runtime,
    };
  }
  return {
    task: "design",
    text: params.text,
    model: params.overrides.model ?? VOICE_DESIGN_MODEL,
    prompt: profile.prompt,
    language: params.overrides.language ?? profile.language,
    responseFormat: params.responseFormat,
    runtime: params.config.runtime,
  };
}

async function postSidecarJson(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<SidecarSynthesisResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = await readResponseTextLimited(response, 500);
    throw new Error(`Qwen3-TTS sidecar error (${response.status}): ${detail || "unknown error"}`);
  }
  const payload = asObject(await response.json());
  const audioBase64 = trimToUndefined(payload?.audioBase64);
  const outputFormat = trimToUndefined(payload?.outputFormat);
  if (!audioBase64 || !outputFormat) {
    throw new Error("Qwen3-TTS sidecar returned an incomplete response");
  }
  return {
    audioBase64,
    outputFormat,
    fileExtension: trimToUndefined(payload?.fileExtension),
    voiceCompatible: payload?.voiceCompatible === true,
    sampleRate: typeof payload?.sampleRate === "number" ? payload.sampleRate : undefined,
  };
}

function parseDirectiveToken(ctx: SpeechDirectiveTokenParseContext) {
  switch (ctx.key) {
    case "voice":
    case "qwen_voice":
      if (!ctx.policy.allowVoice) {
        return { handled: true };
      }
      return { handled: true, overrides: { voice: ctx.value } };
    case "model":
    case "qwen_model":
      if (!ctx.policy.allowModelId) {
        return { handled: true };
      }
      return { handled: true, overrides: { model: ctx.value } };
    case "language":
    case "qwen_language":
      if (!ctx.policy.allowNormalization) {
        return { handled: true };
      }
      return { handled: true, overrides: { language: ctx.value } };
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

export function buildQwen3TtsSpeechProvider(): SpeechProviderPlugin {
  return {
    id: QWEN3_TTS_PROVIDER_ID,
    label: "Qwen3-TTS (local)",
    aliases: ["qwen3tts"],
    autoSelectOrder: 5,
    models: [
      ...Object.values(PRESET_MODEL_BY_QUALITY),
      ...Object.values(CLONE_MODEL_BY_QUALITY),
      VOICE_DESIGN_MODEL,
    ],
    voices: [...QWEN3_TTS_BUILTIN_VOICES],
    resolveConfig: ({ rawConfig }) => resolveQwen3TtsProviderConfig(rawConfig),
    parseDirectiveToken,
    isConfigured: ({ providerConfig }) => {
      const config = readProviderConfig(providerConfig);
      return config.enabled && config.supported;
    },
    synthesize: async ({ text, agentId, providerConfig, providerOverrides, target, timeoutMs }) => {
      const config = readProviderConfig(providerConfig);
      const overrides = readOverrides(providerOverrides);
      const responseFormat = target === "voice-note" ? "opus" : "wav";
      const baseUrl = await ensureManagedQwen3TtsDaemon(config);
      const response = await postSidecarJson(
        `${baseUrl}/synthesize`,
        buildSynthesisPayload({
          text,
          config,
          overrides,
          agentId,
          responseFormat,
        }),
        timeoutMs,
      );
      return {
        audioBuffer: Buffer.from(response.audioBase64, "base64"),
        outputFormat: response.outputFormat,
        fileExtension: response.fileExtension ?? `.${response.outputFormat}`,
        voiceCompatible: response.voiceCompatible ?? target === "voice-note",
      };
    },
    synthesizeTelephony: async ({ text, providerConfig, timeoutMs }) => {
      const config = readProviderConfig(providerConfig);
      const baseUrl = await ensureManagedQwen3TtsDaemon(config);
      const response = await postSidecarJson(
        `${baseUrl}/synthesize-telephony`,
        buildSynthesisPayload({
          text,
          config,
          overrides: {},
          responseFormat: "pcm",
        }),
        timeoutMs,
      );
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
