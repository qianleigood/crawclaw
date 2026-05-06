import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { canonicalizeBase64 } from "../../media/base64.js";
import { getSpeechProvider } from "../../tts/provider-registry.js";
import { getResolvedSpeechProviderConfig, resolveTtsConfig } from "../../tts/tts.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlers } from "./types.js";

const QWEN3_TTS_PROVIDER_ID = "qwen3-tts";
const MAX_REFERENCE_AUDIO_BYTES = 20 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeReferenceAudioName(filename: string): string {
  const parsed = path.parse(filename);
  const base =
    parsed.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/gu, "-")
      .replace(/-+/gu, "-")
      .replace(/^-|-$/gu, "") || `voice-${Date.now()}`;
  const ext = [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"].includes(parsed.ext.toLowerCase())
    ? parsed.ext.toLowerCase()
    : ".wav";
  return `${base}${ext}`;
}

async function probeQwen3TtsHealth(baseUrl: string, healthPath: string) {
  const url = `${baseUrl.replace(/\/+$/u, "")}${healthPath.startsWith("/") ? healthPath : `/${healthPath}`}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) {
      return { reachable: false, ready: false, error: `HTTP ${response.status}` };
    }
    const payload = asRecord(await response.json());
    return {
      reachable: true,
      ready: payload?.ready === true,
      runtime: asTrimmedString(payload?.runtime),
      error: asTrimmedString(payload?.error),
    };
  } catch (error) {
    return {
      reachable: false,
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveQwen3TtsProviderContext() {
  const cfg = loadConfig();
  const ttsConfig = resolveTtsConfig(cfg);
  const provider = getSpeechProvider(QWEN3_TTS_PROVIDER_ID, cfg);
  if (!provider) {
    return { error: `speech provider "${QWEN3_TTS_PROVIDER_ID}" is unavailable` } as const;
  }
  const providerConfig = getResolvedSpeechProviderConfig(ttsConfig, QWEN3_TTS_PROVIDER_ID, cfg);
  return { cfg, provider, providerConfig, ttsConfig } as const;
}

export const voiceHandlers: GatewayRequestHandlers = {
  "voice.getOverview": async ({ respond }) => {
    try {
      const resolved = resolveQwen3TtsProviderContext();
      if ("error" in resolved) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, resolved.error ?? "Qwen3-TTS is unavailable"),
        );
        return;
      }
      const config = asRecord(resolved.providerConfig) ?? {};
      const health = await probeQwen3TtsHealth(
        asTrimmedString(config.baseUrl) ?? "http://127.0.0.1:8013",
        asTrimmedString(config.healthPath) ?? "/health",
      );
      respond(true, {
        activeProvider: resolved.ttsConfig.provider,
        qwen3Tts: {
          enabled: config.enabled === true,
          supported: config.supported === true,
          runtime: asTrimmedString(config.runtime) ?? "qwen-tts",
          managedRuntime: asTrimmedString(config.managedRuntime) ?? null,
          autoStart: config.autoStart === true,
          baseUrl: asTrimmedString(config.baseUrl) ?? "http://127.0.0.1:8013",
          healthPath: asTrimmedString(config.healthPath) ?? "/health",
          defaultProfile: asTrimmedString(config.defaultProfile) ?? "assistant",
          voiceDirectory: asTrimmedString(config.voiceDirectory) ?? "",
          profiles: asRecord(config.profiles) ?? {},
          agentProfiles: asRecord(config.agentProfiles) ?? {},
          builtinVoices: Array.isArray(resolved.provider.voices)
            ? [...resolved.provider.voices]
            : [],
          health,
        },
      });
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(error)));
    }
  },
  "voice.qwen3Tts.preview": async ({ params, respond }) => {
    const text = asTrimmedString((params as { text?: unknown }).text);
    if (!text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "preview text is required"));
      return;
    }
    try {
      const resolved = resolveQwen3TtsProviderContext();
      if ("error" in resolved) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, resolved.error ?? "Qwen3-TTS is unavailable"),
        );
        return;
      }
      const providerConfig = structuredClone(resolved.providerConfig) as Record<string, unknown>;
      const draftProfile = asRecord((params as { draftProfile?: unknown }).draftProfile);
      const requestedProfileId =
        asTrimmedString((params as { profileId?: unknown }).profileId) ??
        (draftProfile ? "__voice_preview__" : asTrimmedString(providerConfig.defaultProfile)) ??
        "assistant";
      if (draftProfile) {
        const profiles = asRecord(providerConfig.profiles) ?? {};
        profiles[requestedProfileId] = draftProfile;
        providerConfig.profiles = profiles;
      }
      const providerOverrides = {
        [QWEN3_TTS_PROVIDER_ID]: {
          profile: requestedProfileId,
        },
      };
      const target =
        asTrimmedString((params as { target?: unknown }).target) === "voice-note"
          ? "voice-note"
          : "audio-file";
      const result = await resolved.provider.synthesize({
        text,
        cfg: resolved.cfg,
        agentId: asTrimmedString((params as { agentId?: unknown }).agentId),
        providerConfig,
        target,
        providerOverrides,
        timeoutMs: resolved.ttsConfig.timeoutMs,
      });
      respond(true, {
        audioBase64: result.audioBuffer.toString("base64"),
        outputFormat: result.outputFormat,
        fileExtension: result.fileExtension,
        voiceCompatible: result.voiceCompatible,
      });
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(error)));
    }
  },
  "voice.qwen3Tts.uploadReferenceAudio": async ({ params, respond }) => {
    const filename = asTrimmedString((params as { filename?: unknown }).filename);
    const audioBase64Raw = asTrimmedString((params as { audioBase64?: unknown }).audioBase64);
    if (!filename || !audioBase64Raw) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "filename and audioBase64 are required"),
      );
      return;
    }
    const audioBase64 = canonicalizeBase64(audioBase64Raw);
    if (!audioBase64) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid audioBase64"));
      return;
    }
    const estimatedBytes = Math.floor((audioBase64.length * 3) / 4);
    if (estimatedBytes > MAX_REFERENCE_AUDIO_BYTES) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "audio file is too large"));
      return;
    }
    try {
      const resolved = resolveQwen3TtsProviderContext();
      if ("error" in resolved) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, resolved.error ?? "Qwen3-TTS is unavailable"),
        );
        return;
      }
      const providerConfig = asRecord(resolved.providerConfig) ?? {};
      const voiceDirectory =
        asTrimmedString(providerConfig.voiceDirectory) ??
        path.join(process.cwd(), ".crawclaw", "voices");
      fs.mkdirSync(voiceDirectory, { recursive: true });
      const storedFilename = sanitizeReferenceAudioName(filename);
      const storedPath = path.join(voiceDirectory, storedFilename);
      fs.writeFileSync(storedPath, Buffer.from(audioBase64, "base64"));
      respond(true, {
        storedPath,
        filename: storedFilename,
      });
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(error)));
    }
  },
};
