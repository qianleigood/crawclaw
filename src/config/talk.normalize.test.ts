import { describe, expect, it } from "vitest";
import { buildTalkConfigResponse, normalizeTalkSection } from "./talk.js";

describe("talk normalization", () => {
  it("drops removed legacy top-level Talk fields", () => {
    const normalized = normalizeTalkSection({
      voiceId: "voice-123",
      voiceAliases: { Clawd: "EXAVITQu4vr4xnSDxMaL" }, // pragma: allowlist secret
      modelId: "eleven_v3",
      outputFormat: "pcm_44100",
      apiKey: "secret-key", // pragma: allowlist secret
      interruptOnSpeech: false,
      silenceTimeoutMs: 1500,
    });

    expect(normalized).toEqual({
      interruptOnSpeech: false,
      silenceTimeoutMs: 1500,
    });
  });

  it("uses new provider/providers shape directly when present", () => {
    const normalized = normalizeTalkSection({
      provider: "acme",
      providers: {
        acme: {
          voiceId: "acme-voice",
          custom: true,
        },
      },
      voiceId: "legacy-voice",
      interruptOnSpeech: true,
    });

    expect(normalized).toEqual({
      provider: "acme",
      providers: {
        acme: {
          voiceId: "acme-voice",
          custom: true,
        },
      },
      interruptOnSpeech: true,
    });
  });

  it("builds a canonical resolved talk payload for clients", () => {
    const payload = buildTalkConfigResponse({
      provider: "acme",
      providers: {
        acme: {
          voiceId: "acme-voice",
          modelId: "acme-model",
        },
      },
      voiceId: "legacy-voice",
      interruptOnSpeech: true,
    });

    expect(payload).toEqual({
      provider: "acme",
      providers: {
        acme: {
          voiceId: "acme-voice",
          modelId: "acme-model",
        },
      },
      resolved: {
        provider: "acme",
        config: {
          voiceId: "acme-voice",
          modelId: "acme-model",
        },
      },
      interruptOnSpeech: true,
    });
  });

  it("fills provider from the single configured talk provider when provider is implicit", () => {
    const payload = buildTalkConfigResponse({
      providers: {
        acme: {
          voiceId: "voice-123",
          apiKey: "secret-key", // pragma: allowlist secret
        },
      },
      silenceTimeoutMs: 1500,
    });

    expect(payload).toEqual({
      provider: "acme",
      providers: {
        acme: {
          voiceId: "voice-123",
          apiKey: "secret-key", // pragma: allowlist secret
        },
      },
      resolved: {
        provider: "acme",
        config: {
          voiceId: "voice-123",
          apiKey: "secret-key", // pragma: allowlist secret
        },
      },
      silenceTimeoutMs: 1500,
    });
  });

  it("preserves SecretRef apiKey values during normalization", () => {
    const normalized = normalizeTalkSection({
      provider: "acme",
      providers: {
        acme: {
          apiKey: { source: "env", provider: "default", id: "TALK_PROVIDER_API_KEY" },
        },
      },
    });

    expect(normalized).toEqual({
      provider: "acme",
      providers: {
        acme: {
          apiKey: { source: "env", provider: "default", id: "TALK_PROVIDER_API_KEY" },
        },
      },
    });
  });
});
