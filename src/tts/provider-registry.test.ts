import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import type { SpeechProviderPlugin } from "../plugins/types.js";

const resolveRuntimePluginRegistryMock = vi.fn();

vi.mock("../plugins/loader.js", () => ({
  resolveRuntimePluginRegistry: (...args: Parameters<typeof resolveRuntimePluginRegistryMock>) =>
    resolveRuntimePluginRegistryMock(...args),
}));

let getSpeechProvider: typeof import("./provider-registry.js").getSpeechProvider;
let listSpeechProviders: typeof import("./provider-registry.js").listSpeechProviders;
let canonicalizeSpeechProviderId: typeof import("./provider-registry.js").canonicalizeSpeechProviderId;
let normalizeSpeechProviderId: typeof import("./provider-registry.js").normalizeSpeechProviderId;

function createSpeechProvider(id: string, aliases?: string[]): SpeechProviderPlugin {
  return {
    id,
    label: id,
    ...(aliases ? { aliases } : {}),
    isConfigured: () => true,
    synthesize: async () => ({
      audioBuffer: Buffer.from("audio"),
      outputFormat: "mp3",
      voiceCompatible: false,
      fileExtension: ".mp3",
    }),
  };
}

describe("speech provider registry", () => {
  beforeAll(async () => {
    ({
      getSpeechProvider,
      listSpeechProviders,
      canonicalizeSpeechProviderId,
      normalizeSpeechProviderId,
    } = await import("./provider-registry.js"));
  });

  beforeEach(() => {
    resolveRuntimePluginRegistryMock.mockReset();
    resolveRuntimePluginRegistryMock.mockReturnValue(undefined);
  });

  afterEach(() => {});

  it("uses active plugin speech providers without reloading plugins", () => {
    resolveRuntimePluginRegistryMock.mockReturnValue({
      ...createEmptyPluginRegistry(),
      speechProviders: [
        {
          pluginId: "test-demo-speech",
          source: "test",
          provider: createSpeechProvider("demo-speech"),
        },
      ],
    });
    const providers = listSpeechProviders();

    expect(providers.map((provider) => provider.id)).toEqual(["demo-speech"]);
    expect(resolveRuntimePluginRegistryMock).toHaveBeenCalledWith();
  });

  it("uses active plugin speech providers even when config is provided", () => {
    resolveRuntimePluginRegistryMock.mockReturnValue({
      ...createEmptyPluginRegistry(),
      speechProviders: [
        {
          pluginId: "test-demo-speech",
          source: "test",
          provider: createSpeechProvider("demo-speech", ["demo-alias"]),
        },
      ],
    });

    const cfg = {} as CrawClawConfig;

    expect(listSpeechProviders(cfg).map((provider) => provider.id)).toEqual(["demo-speech"]);
    expect(getSpeechProvider("demo-alias", cfg)?.id).toBe("demo-speech");
    expect(resolveRuntimePluginRegistryMock).toHaveBeenCalledWith();
  });

  it("loads speech providers from plugins when config is provided and no active providers exist", () => {
    resolveRuntimePluginRegistryMock.mockImplementation((params?: unknown) =>
      params === undefined
        ? createEmptyPluginRegistry()
        : {
            ...createEmptyPluginRegistry(),
            speechProviders: [
              {
                pluginId: "test-qwen3-tts",
                source: "test",
                provider: createSpeechProvider("qwen3-tts"),
              },
            ],
          },
    );

    const cfg = {} as CrawClawConfig;

    expect(listSpeechProviders(cfg).map((provider) => provider.id)).toEqual(["qwen3-tts"]);
    expect(getSpeechProvider("qwen3-tts", cfg)?.id).toBe("qwen3-tts");
    expect(resolveRuntimePluginRegistryMock).toHaveBeenCalledWith({
      config: {
        plugins: {
          entries: {
            "qwen3-tts": { enabled: true },
          },
        },
      },
    });
  });

  it("returns no providers when neither plugins nor active registry provide speech support", () => {
    expect(listSpeechProviders()).toEqual([]);
    expect(getSpeechProvider("demo-speech")).toBeUndefined();
    expect(resolveRuntimePluginRegistryMock).toHaveBeenCalledWith();
  });

  it("canonicalizes provider aliases from the active registry", () => {
    resolveRuntimePluginRegistryMock.mockReturnValue({
      ...createEmptyPluginRegistry(),
      speechProviders: [
        {
          pluginId: "test-demo-speech",
          source: "test",
          provider: createSpeechProvider("demo-speech", ["demo-alias"]),
        },
      ],
    });

    expect(normalizeSpeechProviderId("demo-alias")).toBe("demo-alias");
    expect(canonicalizeSpeechProviderId("demo-alias")).toBe("demo-speech");
  });
});
