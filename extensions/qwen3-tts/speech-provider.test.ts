import type { CrawClawConfig } from "crawclaw/plugin-sdk/config-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildQwen3TtsSpeechProvider,
  QWEN3_TTS_BUILTIN_VOICES,
  resolveQwen3TtsProviderConfig,
} from "./speech-provider.js";

const TEST_CFG = {} as CrawClawConfig;
const ensureManagedQwen3TtsDaemon = vi.hoisted(() =>
  vi.fn(async (config: { baseUrl: string }) => config.baseUrl),
);

vi.mock("./daemon.js", () => ({
  ensureManagedQwen3TtsDaemon,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("resolveQwen3TtsProviderConfig", () => {
  it("defaults to the Apple Silicon MLX runtime on darwin arm64", () => {
    const config = resolveQwen3TtsProviderConfig(
      {
        providers: {
          "qwen3-tts": {
            enabled: true,
            runtime: "auto",
          },
        },
      },
      { platform: "darwin", arch: "arm64" },
    );

    expect(config.runtime).toBe("mlx-audio");
    expect(config.baseUrl).toBe("http://127.0.0.1:8011");
    expect(config.supported).toBe(true);
    expect(config.enabled).toBe(true);
    expect(config.defaultProfile).toBe("assistant");
    expect(config.profiles.assistant).toMatchObject({
      source: "preset",
      quality: "balanced",
      voice: "vivian",
    });
  });

  it("defaults auto-start launch settings for the bundled MLX sidecar on darwin arm64", () => {
    const config = resolveQwen3TtsProviderConfig(
      {
        providers: {
          "qwen3-tts": {
            enabled: true,
            runtime: "auto",
            autoStart: true,
          },
        },
      },
      { platform: "darwin", arch: "arm64" },
    );

    expect(config.autoStart).toBe(true);
    expect(config.managedRuntime).toBe("mlx-audio");
    expect(config.launchCommand).toContain("/runtimes/qwen3-tts/venv/bin/python");
    expect(config.launchArgs?.[0]).toMatch(/qwen3_tts_sidecar\.py$/);
  });

  it("defaults auto-start launch settings for the bundled Python sidecar on linux", () => {
    const config = resolveQwen3TtsProviderConfig(
      {
        providers: {
          "qwen3-tts": {
            enabled: true,
            runtime: "auto",
            autoStart: true,
          },
        },
      },
      { platform: "linux", arch: "x64" },
    );

    expect(config.runtime).toBe("qwen-tts");
    expect(config.baseUrl).toBe("http://127.0.0.1:8013");
    expect(config.managedRuntime).toBe("qwen-tts");
    expect(config.launchCommand).toContain("/runtimes/qwen3-tts/venv/bin/python");
    expect(config.launchArgs?.[0]).toMatch(/qwen3_tts_python_sidecar\.py$/);
    expect(config.supported).toBe(true);
  });

  it("defaults auto-start launch settings for the bundled Python sidecar on Windows", () => {
    const config = resolveQwen3TtsProviderConfig(
      {
        providers: {
          "qwen3-tts": {
            enabled: true,
            runtime: "auto",
            autoStart: true,
          },
        },
      },
      { platform: "win32", arch: "x64" },
    );

    expect(config.runtime).toBe("qwen-tts");
    expect(config.baseUrl).toBe("http://127.0.0.1:8013");
    expect(config.managedRuntime).toBe("qwen-tts");
    expect(config.launchCommand).toContain("/runtimes/qwen3-tts/venv/bin/python");
    expect(config.launchArgs?.[0]).toMatch(/qwen3_tts_python_sidecar\.py$/);
    expect(config.supported).toBe(true);
  });

  it("keeps clone profiles inside the configured voice directory", () => {
    const config = resolveQwen3TtsProviderConfig(
      {
        providers: {
          "qwen3-tts": {
            enabled: true,
            voiceDirectory: "~/.crawclaw/voices",
            profiles: {
              owner: {
                source: "clone",
                refAudio: "~/.crawclaw/voices/owner.wav",
                refText: "reference transcript",
              },
            },
          },
        },
      },
      { platform: "darwin", arch: "arm64" },
    );

    expect(config.profiles.owner).toMatchObject({
      source: "clone",
      refText: "reference transcript",
    });
  });
});

describe("buildQwen3TtsSpeechProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    ensureManagedQwen3TtsDaemon.mockClear();
  });

  it("stays disabled until explicitly enabled in provider config", () => {
    const provider = buildQwen3TtsSpeechProvider();

    expect(
      provider.isConfigured({
        cfg: TEST_CFG,
        providerConfig: resolveQwen3TtsProviderConfig(
          { providers: { "qwen3-tts": {} } },
          { platform: "darwin", arch: "arm64" },
        ),
        timeoutMs: 30_000,
      }),
    ).toBe(false);
  });

  it("synthesizes preset profiles through the local sidecar contract", async () => {
    const provider = buildQwen3TtsSpeechProvider();
    const providerConfig = resolveQwen3TtsProviderConfig(
      {
        providers: {
          "qwen3-tts": {
            enabled: true,
            profiles: {
              assistant: {
                source: "preset",
                quality: "balanced",
                voice: "vivian",
                language: "Auto",
                instructions: "natural, warm, expressive",
              },
            },
          },
        },
      },
      { platform: "darwin", arch: "arm64" },
    );
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        audioBase64: Buffer.from("preset-audio").toString("base64"),
        outputFormat: "wav",
        fileExtension: ".wav",
        voiceCompatible: false,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await provider.synthesize({
      text: "今天先验证普通回复。",
      cfg: TEST_CFG,
      providerConfig,
      target: "audio-file",
      timeoutMs: 30_000,
    });

    expect(result.outputFormat).toBe("wav");
    expect(result.fileExtension).toBe(".wav");
    expect(ensureManagedQwen3TtsDaemon).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "mlx-audio",
        baseUrl: "http://127.0.0.1:8011",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8011/synthesize",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          task: "preset",
          text: "今天先验证普通回复。",
          model: "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
          voice: "vivian",
          language: "Auto",
          instructions: "natural, warm, expressive",
          responseFormat: "wav",
          runtime: "mlx-audio",
        }),
      }),
    );
  });

  it("routes clone profiles with reference audio metadata", async () => {
    const provider = buildQwen3TtsSpeechProvider();
    const providerConfig = resolveQwen3TtsProviderConfig(
      {
        providers: {
          "qwen3-tts": {
            enabled: true,
            voiceDirectory: "~/.crawclaw/voices",
            defaultProfile: "owner",
            profiles: {
              owner: {
                source: "clone",
                quality: "clone",
                refAudio: "~/.crawclaw/voices/owner.wav",
                refText: "reference transcript",
                language: "zh",
              },
            },
          },
        },
      },
      { platform: "linux", arch: "x64" },
    );
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        audioBase64: Buffer.from("clone-audio").toString("base64"),
        outputFormat: "wav",
        fileExtension: ".wav",
        voiceCompatible: false,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await provider.synthesize({
      text: "这次测试克隆音色。",
      cfg: TEST_CFG,
      providerConfig,
      target: "audio-file",
      timeoutMs: 30_000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8013/synthesize",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const firstCall = calls[0];
    const request = firstCall?.[1];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      task: "clone",
      text: "这次测试克隆音色。",
      model: "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
      refText: "reference transcript",
      language: "zh",
      responseFormat: "wav",
      runtime: "qwen-tts",
    });
    expect(typeof body.refAudio).toBe("string");
  });

  it("uses an agent-bound profile before the default profile", async () => {
    const provider = buildQwen3TtsSpeechProvider();
    const providerConfig = resolveQwen3TtsProviderConfig(
      {
        providers: {
          "qwen3-tts": {
            enabled: true,
            voiceDirectory: "~/.crawclaw/voices",
            defaultProfile: "assistant",
            agentProfiles: {
              sales: "owner",
            },
            profiles: {
              assistant: {
                source: "preset",
                quality: "balanced",
                voice: "vivian",
              },
              owner: {
                source: "clone",
                quality: "clone",
                refAudio: "~/.crawclaw/voices/owner.wav",
                refText: "owner reference transcript",
                language: "zh",
              },
            },
          },
        },
      },
      { platform: "linux", arch: "x64" },
    );
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        audioBase64: Buffer.from("agent-profile-audio").toString("base64"),
        outputFormat: "wav",
        fileExtension: ".wav",
        voiceCompatible: false,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const request: Parameters<NonNullable<typeof provider.synthesize>>[0] & { agentId: string } = {
      text: "这个销售智能体应该使用绑定音色。",
      cfg: TEST_CFG,
      providerConfig,
      target: "audio-file",
      timeoutMs: 30_000,
      agentId: "sales",
    };
    await provider.synthesize(request);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      task: "clone",
      refText: "owner reference transcript",
      language: "zh",
    });
  });

  it("routes voice design profiles through the same sidecar contract", async () => {
    const provider = buildQwen3TtsSpeechProvider();
    const providerConfig = resolveQwen3TtsProviderConfig(
      {
        providers: {
          "qwen3-tts": {
            enabled: true,
            defaultProfile: "narrator",
            experimental: true,
            profiles: {
              narrator: {
                source: "design",
                prompt: "A calm mature narrator with warm tone and clear articulation",
                language: "en",
              },
            },
          },
        },
      },
      { platform: "win32", arch: "x64" },
    );
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        audioBase64: Buffer.from("design-audio").toString("base64"),
        outputFormat: "wav",
        fileExtension: ".wav",
        voiceCompatible: false,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await provider.synthesize({
      text: "This is a design profile test.",
      cfg: TEST_CFG,
      providerConfig,
      target: "audio-file",
      timeoutMs: 30_000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8013/synthesize",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          task: "design",
          text: "This is a design profile test.",
          model: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
          prompt: "A calm mature narrator with warm tone and clear articulation",
          language: "en",
          responseFormat: "wav",
          runtime: "qwen-tts",
        }),
      }),
    );
  });

  it("synthesizes telephony audio through the dedicated local endpoint", async () => {
    const provider = buildQwen3TtsSpeechProvider();
    const providerConfig = resolveQwen3TtsProviderConfig(
      {
        providers: {
          "qwen3-tts": {
            enabled: true,
          },
        },
      },
      { platform: "darwin", arch: "arm64" },
    );
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        audioBase64: Buffer.from("telephony-audio").toString("base64"),
        outputFormat: "pcm",
        sampleRate: 24_000,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await provider.synthesizeTelephony?.({
      text: "电话语音测试",
      cfg: TEST_CFG,
      providerConfig,
      timeoutMs: 30_000,
    });

    expect(result).toMatchObject({
      outputFormat: "pcm",
      sampleRate: 24_000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8011/synthesize-telephony",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("returns built-in Qwen voices for voice listing", async () => {
    const provider = buildQwen3TtsSpeechProvider();
    const voices = await provider.listVoices?.({
      cfg: TEST_CFG,
      providerConfig: resolveQwen3TtsProviderConfig(
        {
          providers: {
            "qwen3-tts": {
              enabled: true,
            },
          },
        },
        { platform: "darwin", arch: "arm64" },
      ),
    });

    expect(voices?.map((voice) => voice.id)).toEqual(QWEN3_TTS_BUILTIN_VOICES);
  });
});
