import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildWebSearchProviderConfig } from "./test-helpers.js";

vi.mock("../runtime.js", () => ({
  defaultRuntime: { log: vi.fn(), error: vi.fn() },
}));

const getScopedWebSearchCredential = (key: string) => (search?: Record<string, unknown>) =>
  (search?.[key] as { apiKey?: unknown } | undefined)?.apiKey;
const getConfiguredPluginWebSearchConfig =
  (pluginId: string) => (config?: Record<string, unknown>) =>
    (
      config?.plugins as
        | {
            entries?: Record<
              string,
              { config?: { webSearch?: { apiKey?: unknown; baseUrl?: unknown } } }
            >;
          }
        | undefined
    )?.entries?.[pluginId]?.config?.webSearch;
const getConfiguredPluginWebSearchCredential =
  (pluginId: string) => (config?: Record<string, unknown>) =>
    getConfiguredPluginWebSearchConfig(pluginId)(config)?.apiKey;

const mockWebSearchProviders = [
  {
    id: "searxng",
    envVars: ["SEARXNG_BASE_URL"],
    credentialPath: "plugins.entries.searxng.config.webSearch.baseUrl",
    requiresCredential: false,
    getCredentialValue: (search?: Record<string, unknown>) =>
      (search?.["searxng"] as { baseUrl?: unknown } | undefined)?.baseUrl,
    getConfiguredCredentialValue: (config?: Record<string, unknown>) =>
      getConfiguredPluginWebSearchConfig("searxng")(config)?.baseUrl,
  },
  {
    id: "brave",
    envVars: ["BRAVE_API_KEY"],
    credentialPath: "plugins.entries.brave.config.webSearch.apiKey",
    getCredentialValue: (search?: Record<string, unknown>) => search?.apiKey,
    getConfiguredCredentialValue: getConfiguredPluginWebSearchCredential("brave"),
  },
  {
    id: "gemini",
    envVars: ["GEMINI_API_KEY"],
    credentialPath: "plugins.entries.google.config.webSearch.apiKey",
    getCredentialValue: getScopedWebSearchCredential("gemini"),
    getConfiguredCredentialValue: getConfiguredPluginWebSearchCredential("google"),
  },
  {
    id: "grok",
    envVars: ["XAI_API_KEY"],
    credentialPath: "plugins.entries.xai.config.webSearch.apiKey",
    getCredentialValue: getScopedWebSearchCredential("grok"),
    getConfiguredCredentialValue: getConfiguredPluginWebSearchCredential("xai"),
  },
  {
    id: "kimi",
    envVars: ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
    credentialPath: "plugins.entries.moonshot.config.webSearch.apiKey",
    getCredentialValue: getScopedWebSearchCredential("kimi"),
    getConfiguredCredentialValue: getConfiguredPluginWebSearchCredential("moonshot"),
  },
  {
    id: "perplexity",
    envVars: ["PERPLEXITY_API_KEY", "OPENROUTER_API_KEY"],
    credentialPath: "plugins.entries.perplexity.config.webSearch.apiKey",
    getCredentialValue: getScopedWebSearchCredential("perplexity"),
    getConfiguredCredentialValue: getConfiguredPluginWebSearchCredential("perplexity"),
  },
] as const;

vi.mock("../plugins/web-search-providers.js", () => {
  return {
    resolveBundledPluginWebSearchProviders: () => mockWebSearchProviders,
    resolvePluginWebSearchProviders: () => mockWebSearchProviders,
  };
});

let validateConfigObjectWithPlugins: typeof import("./config.js").validateConfigObjectWithPlugins;

beforeAll(async () => {
  ({ validateConfigObjectWithPlugins } = await import("./config.js"));
});

describe("web search provider config", () => {
  it("rejects removed legacy brave config before bundled web search allowlist compat", () => {
    const res = validateConfigObjectWithPlugins({
      plugins: {
        allow: ["weixin", "legacy-memory"],
      },
      tools: {
        web: {
          search: {
            enabled: true,
            apiKey: "test-brave-key", // pragma: allowlist secret
          },
        },
      },
    });

    expect(res.ok).toBe(false);
    if (res.ok) {
      throw new Error("expected legacy brave config to be rejected");
    }
    expect(res.issues).toContainEqual(
      expect.objectContaining({
        path: "tools.web.search.apiKey",
      }),
    );
    expect(res.warnings).not.toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          "plugin disabled (not in allowlist) but config is present",
        ),
      }),
    );
  });

  it("accepts perplexity provider and config", () => {
    const res = validateConfigObjectWithPlugins(
      buildWebSearchProviderConfig({
        enabled: true,
        provider: "perplexity",
        providerConfig: {
          apiKey: "test-key", // pragma: allowlist secret
          baseUrl: "https://openrouter.ai/api/v1",
          model: "perplexity/sonar-pro",
        },
      }),
    );

    expect(res.ok).toBe(true);
  });

  it("accepts gemini provider and config", () => {
    const res = validateConfigObjectWithPlugins(
      buildWebSearchProviderConfig({
        enabled: true,
        provider: "gemini",
        providerConfig: {
          apiKey: "test-key", // pragma: allowlist secret
          model: "gemini-2.5-flash",
        },
      }),
    );

    expect(res.ok).toBe(true);
  });

  it("accepts searxng provider config on the plugin-owned path", () => {
    const res = validateConfigObjectWithPlugins(
      buildWebSearchProviderConfig({
        enabled: true,
        provider: "searxng",
        providerConfig: {
          baseUrl: {
            source: "env",
            provider: "default",
            id: "SEARXNG_BASE_URL",
          },
        },
      }),
    );

    expect(res.ok).toBe(true);
  });

  it("rejects legacy scoped provider config for bundled providers", () => {
    const res = validateConfigObjectWithPlugins({
      tools: {
        web: {
          search: {
            provider: "gemini",
            gemini: {
              apiKey: "legacy-key",
            },
          },
        },
      },
    });

    expect(res.ok).toBe(false);
  });

  it("accepts gemini provider with no extra config", () => {
    const res = validateConfigObjectWithPlugins(
      buildWebSearchProviderConfig({
        provider: "gemini",
      }),
    );

    expect(res.ok).toBe(true);
  });

  it("accepts brave llm-context mode config", () => {
    const res = validateConfigObjectWithPlugins(
      buildWebSearchProviderConfig({
        provider: "brave",
        providerConfig: {
          mode: "llm-context",
        },
      }),
    );

    expect(res.ok).toBe(true);
  });

  it("rejects invalid brave mode config values", () => {
    const res = validateConfigObjectWithPlugins(
      buildWebSearchProviderConfig({
        provider: "brave",
        providerConfig: {
          mode: "invalid-mode",
        },
      }),
    );

    expect(res.ok).toBe(false);
  });
});
