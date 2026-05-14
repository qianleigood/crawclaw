import { describe, expect, it } from "vitest";
import { normalizeCompatibilityConfigValues } from "./doctor-legacy-config.js";

describe("normalizeCompatibilityConfigValues", () => {
  it("migrates legacy x_search auth into xai plugin-owned config", () => {
    const res = normalizeCompatibilityConfigValues({
      tools: {
        web: {
          x_search: {
            apiKey: "xai-legacy-key",
            enabled: true,
            model: "grok-4-1-fast",
          },
        } as Record<string, unknown>,
      },
    });

    expect((res.config.tools?.web as Record<string, unknown> | undefined)?.x_search).toEqual({
      enabled: true,
      model: "grok-4-1-fast",
    });
    expect(res.config.plugins?.entries?.xai).toEqual({
      enabled: true,
      config: {
        webSearch: {
          apiKey: "xai-legacy-key",
        },
      },
    });
    expect(res.changes).toEqual(
      expect.arrayContaining([
        "Moved tools.web.x_search.apiKey → plugins.entries.xai.config.webSearch.apiKey.",
      ]),
    );
  });

  it("moves missing default account from single-account top-level config when named accounts already exist", () => {
    const res = normalizeCompatibilityConfigValues({
      channels: {
        feishu: {
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: ["123"],
          groupPolicy: "allowlist",
          defaultTo: "chat:root",
          accounts: {
            alerts: {
              enabled: true,
              defaultTo: "chat:alerts",
            },
          },
        },
      },
    });

    expect(res.config.channels?.feishu?.accounts?.default).toEqual({
      dmPolicy: "allowlist",
      allowFrom: ["123"],
      groupPolicy: "allowlist",
      defaultTo: "chat:root",
    });
    expect(res.config.channels?.feishu?.dmPolicy).toBeUndefined();
    expect(res.config.channels?.feishu?.allowFrom).toBeUndefined();
    expect(res.config.channels?.feishu?.groupPolicy).toBeUndefined();
    expect(res.config.channels?.feishu?.defaultTo).toBeUndefined();
    expect(res.config.channels?.feishu?.accounts?.alerts?.defaultTo).toBe("chat:alerts");
    expect(res.changes).toContain(
      "Moved channels.feishu single-account top-level values into channels.feishu.accounts.default.",
    );
  });

  it("migrates browser ssrfPolicy allowPrivateNetwork to dangerouslyAllowPrivateNetwork", () => {
    const res = normalizeCompatibilityConfigValues({
      browser: {
        ssrfPolicy: {
          allowPrivateNetwork: true,
          allowedHostnames: ["localhost"],
        },
      },
    });

    expect(res.config.browser?.ssrfPolicy?.allowPrivateNetwork).toBeUndefined();
    expect(res.config.browser?.ssrfPolicy?.dangerouslyAllowPrivateNetwork).toBe(true);
    expect(res.config.browser?.ssrfPolicy?.allowedHostnames).toEqual(["localhost"]);
    expect(res.changes).toContain(
      "Moved browser.ssrfPolicy.allowPrivateNetwork → browser.ssrfPolicy.dangerouslyAllowPrivateNetwork (true).",
    );
  });

  it("normalizes conflicting browser SSRF alias keys without changing effective behavior", () => {
    const res = normalizeCompatibilityConfigValues({
      browser: {
        ssrfPolicy: {
          allowPrivateNetwork: true,
          dangerouslyAllowPrivateNetwork: false,
        },
      },
    });

    expect(res.config.browser?.ssrfPolicy?.allowPrivateNetwork).toBeUndefined();
    expect(res.config.browser?.ssrfPolicy?.dangerouslyAllowPrivateNetwork).toBe(true);
    expect(res.changes).toContain(
      "Moved browser.ssrfPolicy.allowPrivateNetwork → browser.ssrfPolicy.dangerouslyAllowPrivateNetwork (true).",
    );
  });

  it("removes nano-banana skill config while preserving google provider auth migration", () => {
    const res = normalizeCompatibilityConfigValues({
      skills: {
        entries: {
          "nano-banana-pro": {
            enabled: true,
            apiKey: { source: "env", provider: "default", id: "GEMINI_API_KEY" },
          },
        },
      },
    });

    expect(res.config.agents?.defaults).toBeUndefined();
    expect(res.config.models?.providers?.google?.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "GEMINI_API_KEY",
    });
    expect(res.config.models?.providers?.google?.baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
    expect(res.config.models?.providers?.google?.models).toEqual([]);
    expect(res.config.skills?.entries).toBeUndefined();
    expect(res.changes).toEqual([
      "Moved skills.entries.nano-banana-pro.apiKey → models.providers.google.apiKey.",
      "Removed legacy skills.entries.nano-banana-pro.",
    ]);
  });

  it("prefers legacy nano-banana env.GEMINI_API_KEY over skill apiKey during migration", () => {
    const res = normalizeCompatibilityConfigValues({
      skills: {
        entries: {
          "nano-banana-pro": {
            apiKey: "ignored-skill-api-key",
            env: {
              GEMINI_API_KEY: "env-gemini-key",
            },
          },
        },
      },
    });

    expect(res.config.models?.providers?.google?.apiKey).toBe("env-gemini-key");
    expect(res.config.models?.providers?.google?.baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
    expect(res.config.models?.providers?.google?.models).toEqual([]);
    expect(res.changes).toContain(
      "Moved skills.entries.nano-banana-pro.env.GEMINI_API_KEY → models.providers.google.apiKey.",
    );
  });

  it("preserves unrelated agent defaults while removing legacy nano-banana skill config", () => {
    const res = normalizeCompatibilityConfigValues({
      agents: {
        defaults: {
          imageModel: {
            primary: "openai/gpt-4.1-mini",
          },
        },
      },
      models: {
        providers: {
          google: {
            apiKey: "existing-google-key",
            baseUrl: "https://generativelanguage.googleapis.com",
            models: [],
          },
        },
      },
      skills: {
        entries: {
          "nano-banana-pro": {
            apiKey: "legacy-gemini-key",
          },
          peekaboo: { enabled: true },
        },
      },
    });

    expect(res.config.agents?.defaults?.imageModel).toEqual({
      primary: "openai/gpt-4.1-mini",
    });
    expect(res.config.models?.providers?.google?.apiKey).toBe("existing-google-key");
    expect(res.config.skills?.entries).toEqual({
      peekaboo: { enabled: true },
    });
    expect(res.changes).toEqual(["Removed legacy skills.entries.nano-banana-pro."]);
  });

  it("removes nano-banana from skills.allowBundled during migration", () => {
    const res = normalizeCompatibilityConfigValues({
      skills: {
        allowBundled: ["peekaboo", "nano-banana-pro"],
      },
    });

    expect(res.config.skills?.allowBundled).toEqual(["peekaboo"]);
    expect(res.changes).toEqual(["Removed nano-banana-pro from skills.allowBundled."]);
  });

  it("migrates legacy web search provider config to plugin-owned config paths", () => {
    const res = normalizeCompatibilityConfigValues({
      tools: {
        web: {
          search: {
            provider: "gemini",
            maxResults: 5,
            apiKey: "brave-key",
            gemini: {
              apiKey: "gemini-key",
              model: "gemini-2.5-flash",
            },
          },
        },
      },
    });

    expect(res.config.tools?.web?.search).toEqual({
      provider: "gemini",
      maxResults: 5,
    });
    expect(res.config.plugins?.entries?.brave).toEqual({
      enabled: true,
      config: {
        webSearch: {
          apiKey: "brave-key",
        },
      },
    });
    expect(res.changes).toEqual([
      "Moved tools.web.search.apiKey → plugins.entries.brave.config.webSearch.apiKey.",
    ]);
  });

  it("merges legacy web search provider config into explicit plugin config without overriding it", () => {
    const res = normalizeCompatibilityConfigValues({
      tools: {
        web: {
          search: {
            provider: "gemini",
            gemini: {
              apiKey: "legacy-gemini-key",
              model: "legacy-model",
            },
          },
        },
      },
      plugins: {
        entries: {
          google: {
            enabled: true,
            config: {
              webSearch: {
                model: "explicit-model",
                baseUrl: "https://generativelanguage.googleapis.com",
              },
            },
          },
        },
      },
    });

    expect(res.config.tools?.web?.search).toEqual({
      provider: "gemini",
      gemini: {
        apiKey: "legacy-gemini-key",
        model: "legacy-model",
      },
    });
    expect(res.config.plugins?.entries?.google).toEqual({
      enabled: true,
      config: {
        webSearch: {
          model: "explicit-model",
          baseUrl: "https://generativelanguage.googleapis.com",
        },
      },
    });
    expect(res.changes).toEqual([]);
  });

  it("migrates legacy talk flat fields to provider/providers", () => {
    const res = normalizeCompatibilityConfigValues({
      talk: {
        voiceId: "voice-123",
        voiceAliases: {
          Clawd: "EXAVITQu4vr4xnSDxMaL",
        },
        modelId: "eleven_v3",
        outputFormat: "pcm_44100",
        apiKey: "secret-key",
        interruptOnSpeech: false,
        silenceTimeoutMs: 1500,
      },
    });

    expect(res.config.talk).toEqual({
      providers: {
        elevenlabs: {
          voiceId: "voice-123",
          voiceAliases: {
            Clawd: "EXAVITQu4vr4xnSDxMaL",
          },
          modelId: "eleven_v3",
          outputFormat: "pcm_44100",
          apiKey: "secret-key",
        },
      },
      voiceId: "voice-123",
      voiceAliases: {
        Clawd: "EXAVITQu4vr4xnSDxMaL",
      },
      modelId: "eleven_v3",
      outputFormat: "pcm_44100",
      apiKey: "secret-key",
      interruptOnSpeech: false,
      silenceTimeoutMs: 1500,
    });
    expect(res.changes).toEqual(["Moved legacy talk flat fields → talk.providers.elevenlabs."]);
  });

  it("normalizes talk provider ids without overriding explicit provider config", () => {
    const res = normalizeCompatibilityConfigValues({
      talk: {
        provider: " elevenlabs ",
        providers: {
          " elevenlabs ": {
            voiceId: "voice-123",
          },
        },
        apiKey: "secret-key",
      },
    });

    expect(res.config.talk).toEqual({
      provider: "elevenlabs",
      providers: {
        elevenlabs: {
          voiceId: "voice-123",
        },
      },
      apiKey: "secret-key",
    });
    expect(res.changes).toEqual([
      "Normalized talk.provider/providers shape (trimmed provider ids and merged missing compatibility fields).",
    ]);
  });

  it("migrates tools.message.allowCrossContextSend to canonical crossContext settings", () => {
    const res = normalizeCompatibilityConfigValues({
      tools: {
        message: {
          allowCrossContextSend: true,
          crossContext: {
            allowWithinProvider: false,
            allowAcrossProviders: false,
          },
        },
      },
    });

    expect(res.config.tools?.message).toEqual({
      crossContext: {
        allowWithinProvider: true,
        allowAcrossProviders: true,
      },
    });
    expect(res.changes).toEqual([
      "Moved tools.message.allowCrossContextSend → tools.message.crossContext.allowWithinProvider/allowAcrossProviders (true).",
    ]);
  });

  it("normalizes persisted mistral model maxTokens that matched the old context-sized defaults", () => {
    const res = normalizeCompatibilityConfigValues({
      models: {
        providers: {
          mistral: {
            baseUrl: "https://api.mistral.ai/v1",
            api: "openai-completions",
            models: [
              {
                id: "mistral-large-latest",
                name: "Mistral Large",
                reasoning: false,
                input: ["text", "image"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 262144,
                maxTokens: 262144,
              },
              {
                id: "magistral-small",
                name: "Magistral Small",
                reasoning: true,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 128000,
              },
            ],
          },
        },
      },
    });

    expect(res.config.models?.providers?.mistral?.models).toEqual([
      expect.objectContaining({
        id: "mistral-large-latest",
        maxTokens: 16384,
      }),
      expect.objectContaining({
        id: "magistral-small",
        maxTokens: 40000,
      }),
    ]);
    expect(res.changes).toEqual([
      "Normalized models.providers.mistral.models[0].maxTokens (262144 → 16384) to avoid Mistral context-window rejects.",
      "Normalized models.providers.mistral.models[1].maxTokens (128000 → 40000) to avoid Mistral context-window rejects.",
    ]);
  });
});
