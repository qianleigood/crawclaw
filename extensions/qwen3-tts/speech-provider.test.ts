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
const runNativePluginOperation = vi.hoisted(() => vi.fn());

vi.mock("./daemon.js", () => ({
  ensureManagedQwen3TtsDaemon,
}));

vi.mock("crawclaw/plugin-sdk/native-plugin-runtime", () => ({
  runNativePluginOperation,
}));

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
    expect(config.launchCommand).toContain("/qwen3-tts/venv/bin/python");
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
    expect(config.launchCommand).toContain("/qwen3-tts/venv/bin/python");
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
    expect(config.launchCommand).toContain("/qwen3-tts/venv/bin/python");
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
  afterEach(() => {
    vi.restoreAllMocks();
    ensureManagedQwen3TtsDaemon.mockClear();
    runNativePluginOperation.mockReset();
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
    runNativePluginOperation.mockResolvedValue({
      audioBase64: Buffer.from("preset-audio").toString("base64"),
      outputFormat: "wav",
      fileExtension: ".wav",
      voiceCompatible: false,
    });

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
    expect(runNativePluginOperation).toHaveBeenCalledWith({
      plugin: "qwen3-tts",
      operation: "synthesize",
      input: expect.objectContaining({
        text: "今天先验证普通回复。",
        target: "audio-file",
        providerConfig: expect.objectContaining({
          runtime: "mlx-audio",
          baseUrl: "http://127.0.0.1:8011",
        }),
      }),
      timeoutMs: 30_000,
    });
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
    runNativePluginOperation.mockResolvedValue({
      audioBase64: Buffer.from("clone-audio").toString("base64"),
      outputFormat: "wav",
      fileExtension: ".wav",
      voiceCompatible: false,
    });

    await provider.synthesize({
      text: "这次测试克隆音色。",
      cfg: TEST_CFG,
      providerConfig,
      target: "audio-file",
      timeoutMs: 30_000,
    });

    expect(runNativePluginOperation).toHaveBeenCalledWith({
      plugin: "qwen3-tts",
      operation: "synthesize",
      input: expect.objectContaining({
        text: "这次测试克隆音色。",
        target: "audio-file",
        providerConfig: expect.objectContaining({
          runtime: "qwen-tts",
          defaultProfile: "owner",
        }),
      }),
      timeoutMs: 30_000,
    });
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
    runNativePluginOperation.mockResolvedValue({
      audioBase64: Buffer.from("agent-profile-audio").toString("base64"),
      outputFormat: "wav",
      fileExtension: ".wav",
      voiceCompatible: false,
    });

    const request: Parameters<NonNullable<typeof provider.synthesize>>[0] & { agentId: string } = {
      text: "这个销售智能体应该使用绑定音色。",
      cfg: TEST_CFG,
      providerConfig,
      target: "audio-file",
      timeoutMs: 30_000,
      agentId: "sales",
    };
    await provider.synthesize(request);

    expect(runNativePluginOperation).toHaveBeenCalledWith({
      plugin: "qwen3-tts",
      operation: "synthesize",
      input: expect.objectContaining({
        agentId: "sales",
        providerConfig: expect.objectContaining({
          agentProfiles: { sales: "owner" },
        }),
      }),
      timeoutMs: 30_000,
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
    runNativePluginOperation.mockResolvedValue({
      audioBase64: Buffer.from("design-audio").toString("base64"),
      outputFormat: "wav",
      fileExtension: ".wav",
      voiceCompatible: false,
    });

    await provider.synthesize({
      text: "This is a design profile test.",
      cfg: TEST_CFG,
      providerConfig,
      target: "audio-file",
      timeoutMs: 30_000,
    });

    expect(runNativePluginOperation).toHaveBeenCalledWith({
      plugin: "qwen3-tts",
      operation: "synthesize",
      input: expect.objectContaining({
        text: "This is a design profile test.",
        target: "audio-file",
        providerConfig: expect.objectContaining({
          runtime: "qwen-tts",
          defaultProfile: "narrator",
        }),
      }),
      timeoutMs: 30_000,
    });
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
    runNativePluginOperation.mockResolvedValue({
      audioBase64: Buffer.from("telephony-audio").toString("base64"),
      outputFormat: "pcm",
      sampleRate: 24_000,
    });

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
    expect(runNativePluginOperation).toHaveBeenCalledWith({
      plugin: "qwen3-tts",
      operation: "synthesize",
      input: expect.objectContaining({
        text: "电话语音测试",
        target: "telephony",
      }),
      timeoutMs: 30_000,
    });
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
