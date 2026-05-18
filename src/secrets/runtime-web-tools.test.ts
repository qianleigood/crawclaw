import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import type {
  PluginWebFetchProviderEntry,
  PluginWebSearchProviderEntry,
} from "../plugins/types.js";

type ProviderUnderTest = "alpha" | "beta" | "gamma" | "delta" | "epsilon" | "searxng";

const { resolveBundledPluginWebSearchProvidersMock } = vi.hoisted(() => ({
  resolveBundledPluginWebSearchProvidersMock: vi.fn(() => buildTestWebSearchProviders()),
}));

const { resolveBundledPluginWebFetchProvidersMock } = vi.hoisted(() => ({
  resolveBundledPluginWebFetchProvidersMock: vi.fn(() => buildTestWebFetchProviders()),
}));

let bundledWebSearchProviders: typeof import("../plugins/web-search-providers.js");
let bundledWebFetchProviders: typeof import("../plugins/web-fetch-providers.js");
let secretResolve: typeof import("./resolve.js");
let createResolverContext: typeof import("./runtime-shared.js").createResolverContext;
let resolveRuntimeWebTools: typeof import("./runtime-web-tools.js").resolveRuntimeWebTools;

vi.mock("../plugins/web-search-providers.js", () => ({
  resolveBundledPluginWebSearchProviders: resolveBundledPluginWebSearchProvidersMock,
}));

vi.mock("../plugins/web-fetch-providers.js", () => ({
  resolveBundledPluginWebFetchProviders: resolveBundledPluginWebFetchProvidersMock,
}));

function asConfig(value: unknown): CrawClawConfig {
  return value as CrawClawConfig;
}

function providerPluginId(provider: ProviderUnderTest): string {
  switch (provider) {
    case "searxng":
      return "searxng";
    case "beta":
      return "beta-plugin";
    case "gamma":
      return "gamma-plugin";
    case "delta":
      return "delta-plugin";
    default:
      return provider;
  }
}

function ensureRecord(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = target[key];
  if (typeof current === "object" && current !== null && !Array.isArray(current)) {
    return current as Record<string, unknown>;
  }
  const next: Record<string, unknown> = {};
  target[key] = next;
  return next;
}

function setConfiguredProviderKey(
  configTarget: CrawClawConfig,
  pluginId: string,
  value: unknown,
): void {
  const plugins = ensureRecord(configTarget as Record<string, unknown>, "plugins");
  const entries = ensureRecord(plugins, "entries");
  const pluginEntry = ensureRecord(entries, pluginId);
  const config = ensureRecord(pluginEntry, "config");
  const webSearch = ensureRecord(config, "webSearch");
  webSearch.apiKey = value;
}

function setConfiguredFetchProviderKey(configTarget: CrawClawConfig, value: unknown): void {
  const plugins = ensureRecord(configTarget as Record<string, unknown>, "plugins");
  const entries = ensureRecord(plugins, "entries");
  const pluginEntry = ensureRecord(entries, "spider");
  const config = ensureRecord(pluginEntry, "config");
  const webFetch = ensureRecord(config, "webFetch");
  webFetch.apiKey = value;
}

function createTestProvider(params: {
  provider: ProviderUnderTest;
  pluginId: string;
  order: number;
}): PluginWebSearchProviderEntry {
  const credentialPath = `plugins.entries.${params.pluginId}.config.webSearch.apiKey`;
  return {
    pluginId: params.pluginId,
    id: params.provider,
    label: params.provider,
    hint: `${params.provider} test provider`,
    requiresCredential: params.provider === "searxng" ? false : undefined,
    envVars: params.provider === "searxng" ? [] : [`${params.provider.toUpperCase()}_API_KEY`],
    placeholder: params.provider === "searxng" ? "(no key needed)" : `${params.provider}-...`,
    signupUrl: `https://example.com/${params.provider}`,
    autoDetectOrder: params.order,
    credentialPath: params.provider === "searxng" ? "" : credentialPath,
    inactiveSecretPaths: params.provider === "searxng" ? [] : [credentialPath],
    getCredentialValue: (searchConfig) =>
      params.provider === "searxng" ? "searxng-no-key-needed" : searchConfig?.apiKey,
    setCredentialValue: (searchConfigTarget, value) => {
      searchConfigTarget.apiKey = value;
    },
    getConfiguredCredentialValue: (config) => {
      const entryConfig = config?.plugins?.entries?.[params.pluginId]?.config;
      return entryConfig && typeof entryConfig === "object"
        ? (entryConfig as { webSearch?: { apiKey?: unknown } }).webSearch?.apiKey
        : undefined;
    },
    setConfiguredCredentialValue: (configTarget, value) => {
      setConfiguredProviderKey(configTarget, params.pluginId, value);
    },
  };
}

function buildTestWebSearchProviders(): PluginWebSearchProviderEntry[] {
  return [
    createTestProvider({ provider: "alpha", pluginId: "alpha", order: 10 }),
    createTestProvider({ provider: "beta", pluginId: "beta-plugin", order: 20 }),
    createTestProvider({ provider: "gamma", pluginId: "gamma-plugin", order: 30 }),
    createTestProvider({ provider: "delta", pluginId: "delta-plugin", order: 40 }),
    createTestProvider({ provider: "epsilon", pluginId: "epsilon", order: 50 }),
    createTestProvider({ provider: "searxng", pluginId: "searxng", order: 100 }),
  ];
}

function buildTestWebFetchProviders(): PluginWebFetchProviderEntry[] {
  return [
    {
      pluginId: "spider",
      id: "spider",
      label: "spider",
      hint: "spider test provider",
      envVars: ["SPIDER_API_KEY"],
      placeholder: "spider-...",
      signupUrl: "https://example.com/spider",
      autoDetectOrder: 50,
      credentialPath: "plugins.entries.spider.config.webFetch.apiKey",
      inactiveSecretPaths: ["plugins.entries.spider.config.webFetch.apiKey"],
      getCredentialValue: (fetchConfig) => fetchConfig?.apiKey,
      setCredentialValue: (fetchConfigTarget, value) => {
        fetchConfigTarget.apiKey = value;
      },
      getConfiguredCredentialValue: (config) => {
        const entryConfig = config?.plugins?.entries?.spider?.config;
        return entryConfig && typeof entryConfig === "object"
          ? (entryConfig as { webFetch?: { apiKey?: unknown } }).webFetch?.apiKey
          : undefined;
      },
      setConfiguredCredentialValue: (configTarget, value) => {
        setConfiguredFetchProviderKey(configTarget, value);
      },
    },
  ];
}

async function runRuntimeWebTools(params: { config: CrawClawConfig; env?: NodeJS.ProcessEnv }) {
  const sourceConfig = structuredClone(params.config);
  const resolvedConfig = structuredClone(params.config);
  const context = createResolverContext({
    sourceConfig,
    env: params.env ?? {},
  });
  const metadata = await resolveRuntimeWebTools({
    sourceConfig,
    resolvedConfig,
    context,
  });
  return { metadata, resolvedConfig, context };
}

function createProviderSecretRefConfig(
  provider: ProviderUnderTest,
  envRefId: string,
): CrawClawConfig {
  return asConfig({
    tools: {
      web: {
        search: {
          enabled: true,
          provider,
        },
      },
    },
    plugins: {
      entries: {
        [providerPluginId(provider)]: {
          enabled: true,
          config: {
            webSearch: {
              apiKey: { source: "env", provider: "default", id: envRefId },
            },
          },
        },
      },
    },
  });
}

function readProviderKey(config: CrawClawConfig, provider: ProviderUnderTest): unknown {
  const pluginConfig = config.plugins?.entries?.[providerPluginId(provider)]?.config as
    | { webSearch?: { apiKey?: unknown } }
    | undefined;
  return pluginConfig?.webSearch?.apiKey;
}

function expectInactiveWebFetchProviderSecretRef(params: {
  resolveSpy: ReturnType<typeof vi.spyOn>;
  metadata: Awaited<ReturnType<typeof runRuntimeWebTools>>["metadata"];
  context: Awaited<ReturnType<typeof runRuntimeWebTools>>["context"];
}) {
  expect(params.resolveSpy).not.toHaveBeenCalled();
  expect(params.metadata.fetch.selectedProvider).toBeUndefined();
  expect(params.metadata.fetch.selectedProviderKeySource).toBeUndefined();
  expect(params.context.warnings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "SECRETS_REF_IGNORED_INACTIVE_SURFACE",
        path: "plugins.entries.spider.config.webFetch.apiKey",
      }),
    ]),
  );
}

describe("runtime web tools resolution", () => {
  beforeAll(async () => {
    bundledWebSearchProviders = await import("../plugins/web-search-providers.js");
    bundledWebFetchProviders = await import("../plugins/web-fetch-providers.js");
    secretResolve = await import("./resolve.js");
    ({ createResolverContext } = await import("./runtime-shared.js"));
    ({ resolveRuntimeWebTools } = await import("./runtime-web-tools.js"));
  });

  beforeEach(() => {
    vi.mocked(bundledWebSearchProviders.resolveBundledPluginWebSearchProviders).mockClear();
    vi.mocked(bundledWebFetchProviders.resolveBundledPluginWebFetchProviders).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps web search inactive when only web fetch is configured", async () => {
    const { metadata } = await runRuntimeWebTools({
      config: asConfig({
        plugins: {
          entries: {
            spider: {
              config: {
                webFetch: {
                  apiKey: { source: "env", provider: "default", id: "SPIDER_API_KEY_REF" },
                },
              },
            },
          },
        },
        tools: {
          web: {
            fetch: {
              provider: "spider",
            },
          },
        },
      }),
      env: {
        SPIDER_API_KEY: "spider-runtime-key", // pragma: allowlist secret
      },
    });

    expect(metadata.search.selectedProvider).toBeUndefined();
    expect(metadata.search.providerSource).toBe("none");
    expect(metadata.fetch.selectedProvider).toBe("spider");
    expect(metadata.fetch.selectedProviderKeySource).toBe("env");
  });

  it("auto-selects a keyless provider when no credentials are configured", async () => {
    const { metadata } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {
              enabled: true,
            },
          },
        },
      }),
    });

    expect(metadata.search.selectedProvider).toBe("searxng");
    expect(metadata.search.providerSource).toBe("auto-detect");
    expect(metadata.search.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_SEARCH_AUTODETECT_SELECTED",
          message: expect.stringContaining('keyless provider "searxng"'),
        }),
      ]),
    );
  });

  it.each([
    {
      provider: "alpha" as const,
      envRefId: "ALPHA_PROVIDER_REF",
      resolvedKey: "alpha-provider-key",
    },
    {
      provider: "beta" as const,
      envRefId: "BETA_PROVIDER_REF",
      resolvedKey: "beta-provider-key",
    },
    {
      provider: "gamma" as const,
      envRefId: "GAMMA_PROVIDER_REF",
      resolvedKey: "gamma-provider-key",
    },
    {
      provider: "delta" as const,
      envRefId: "DELTA_PROVIDER_REF",
      resolvedKey: "delta-provider-key",
    },
    {
      provider: "epsilon" as const,
      envRefId: "EPSILON_PROVIDER_REF",
      resolvedKey: "epsilon-provider-key",
    },
  ])(
    "resolves configured provider SecretRef for $provider",
    async ({ provider, envRefId, resolvedKey }) => {
      const { metadata, resolvedConfig, context } = await runRuntimeWebTools({
        config: createProviderSecretRefConfig(provider, envRefId),
        env: {
          [envRefId]: resolvedKey,
        },
      });

      expect(metadata.search.providerConfigured).toBe(provider);
      expect(metadata.search.providerSource).toBe("configured");
      expect(metadata.search.selectedProvider).toBe(provider);
      expect(metadata.search.selectedProviderKeySource).toBe("secretRef");
      expect(readProviderKey(resolvedConfig, provider)).toBe(resolvedKey);
      expect(context.warnings.map((warning) => warning.code)).not.toContain(
        "WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK",
      );
    },
  );

  it("auto-detects provider precedence across all configured providers", async () => {
    const { metadata, resolvedConfig, context } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {
              enabled: true,
            },
          },
        },
        plugins: {
          entries: {
            alpha: {
              enabled: true,
              config: {
                webSearch: { apiKey: { source: "env", provider: "default", id: "ALPHA_REF" } },
              },
            },
            "beta-plugin": {
              enabled: true,
              config: {
                webSearch: { apiKey: { source: "env", provider: "default", id: "BETA_REF" } },
              },
            },
            "gamma-plugin": {
              enabled: true,
              config: {
                webSearch: { apiKey: { source: "env", provider: "default", id: "GAMMA_REF" } },
              },
            },
            "delta-plugin": {
              enabled: true,
              config: {
                webSearch: { apiKey: { source: "env", provider: "default", id: "DELTA_REF" } },
              },
            },
            epsilon: {
              enabled: true,
              config: {
                webSearch: { apiKey: { source: "env", provider: "default", id: "EPSILON_REF" } },
              },
            },
          },
        },
      }),
      env: {
        ALPHA_REF: "alpha-precedence-key",
        BETA_REF: "beta-precedence-key",
        GAMMA_REF: "gamma-precedence-key",
        DELTA_REF: "delta-precedence-key",
        EPSILON_REF: "epsilon-precedence-key",
      },
    });

    expect(metadata.search.providerSource).toBe("auto-detect");
    expect(metadata.search.selectedProvider).toBe("alpha");
    expect(readProviderKey(resolvedConfig, "alpha")).toBe("alpha-precedence-key");
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "plugins.entries.beta-plugin.config.webSearch.apiKey" }),
        expect.objectContaining({ path: "plugins.entries.gamma-plugin.config.webSearch.apiKey" }),
        expect.objectContaining({ path: "plugins.entries.delta-plugin.config.webSearch.apiKey" }),
        expect.objectContaining({ path: "plugins.entries.epsilon.config.webSearch.apiKey" }),
      ]),
    );
  });

  it("auto-detects first available provider and keeps lower-priority refs inactive", async () => {
    const { metadata, resolvedConfig, context } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {
              enabled: true,
            },
          },
        },
        plugins: {
          entries: {
            alpha: {
              enabled: true,
              config: {
                webSearch: {
                  apiKey: { source: "env", provider: "default", id: "ALPHA_API_KEY_REF" },
                },
              },
            },
            "beta-plugin": {
              enabled: true,
              config: {
                webSearch: {
                  apiKey: { source: "env", provider: "default", id: "MISSING_BETA_API_KEY_REF" },
                },
              },
            },
          },
        },
      }),
      env: {
        ALPHA_API_KEY_REF: "alpha-runtime-key", // pragma: allowlist secret
      },
    });

    expect(metadata.search.providerSource).toBe("auto-detect");
    expect(metadata.search.selectedProvider).toBe("alpha");
    expect(metadata.search.selectedProviderKeySource).toBe("secretRef");
    expect(readProviderKey(resolvedConfig, "alpha")).toBe("alpha-runtime-key");
    expect(readProviderKey(resolvedConfig, "beta")).toEqual({
      source: "env",
      provider: "default",
      id: "MISSING_BETA_API_KEY_REF",
    });
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SECRETS_REF_IGNORED_INACTIVE_SURFACE",
          path: "plugins.entries.beta-plugin.config.webSearch.apiKey",
        }),
      ]),
    );
    expect(context.warnings.map((warning) => warning.code)).not.toContain(
      "WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK",
    );
  });

  it("auto-detects the next provider when a higher-priority ref is unresolved", async () => {
    const { metadata, resolvedConfig, context } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {
              enabled: true,
            },
          },
        },
        plugins: {
          entries: {
            alpha: {
              enabled: true,
              config: {
                webSearch: {
                  apiKey: { source: "env", provider: "default", id: "MISSING_ALPHA_API_KEY_REF" },
                },
              },
            },
            "beta-plugin": {
              enabled: true,
              config: {
                webSearch: {
                  apiKey: { source: "env", provider: "default", id: "BETA_API_KEY_REF" },
                },
              },
            },
          },
        },
      }),
      env: {
        BETA_API_KEY_REF: "beta-runtime-key", // pragma: allowlist secret
      },
    });

    expect(metadata.search.providerSource).toBe("auto-detect");
    expect(metadata.search.selectedProvider).toBe("beta");
    expect(readProviderKey(resolvedConfig, "beta")).toBe("beta-runtime-key");
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SECRETS_REF_IGNORED_INACTIVE_SURFACE",
          path: "plugins.entries.alpha.config.webSearch.apiKey",
        }),
      ]),
    );
    expect(context.warnings.map((warning) => warning.code)).not.toContain(
      "WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK",
    );
  });

  it("warns when provider is invalid and falls back to auto-detect", async () => {
    const { metadata, resolvedConfig, context } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {
              provider: "invalid-provider",
            },
          },
        },
        plugins: {
          entries: {
            "beta-plugin": {
              enabled: true,
              config: {
                webSearch: {
                  apiKey: { source: "env", provider: "default", id: "BETA_API_KEY_REF" },
                },
              },
            },
          },
        },
      }),
      env: {
        BETA_API_KEY_REF: "beta-runtime-key", // pragma: allowlist secret
      },
    });

    expect(metadata.search.providerConfigured).toBeUndefined();
    expect(metadata.search.providerSource).toBe("auto-detect");
    expect(metadata.search.selectedProvider).toBe("beta");
    expect(readProviderKey(resolvedConfig, "beta")).toBe("beta-runtime-key");
    expect(metadata.search.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_SEARCH_PROVIDER_INVALID_AUTODETECT",
          path: "tools.web.search.provider",
        }),
      ]),
    );
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_SEARCH_PROVIDER_INVALID_AUTODETECT",
          path: "tools.web.search.provider",
        }),
      ]),
    );
  });

  it("fails fast when configured provider ref is unresolved with no fallback", async () => {
    const sourceConfig = asConfig({
      tools: {
        web: {
          search: {
            provider: "beta",
          },
        },
      },
      plugins: {
        entries: {
          "beta-plugin": {
            enabled: true,
            config: {
              webSearch: {
                apiKey: { source: "env", provider: "default", id: "MISSING_BETA_API_KEY_REF" },
              },
            },
          },
        },
      },
    });
    const resolvedConfig = structuredClone(sourceConfig);
    const context = createResolverContext({
      sourceConfig,
      env: {},
    });

    await expect(
      resolveRuntimeWebTools({
        sourceConfig,
        resolvedConfig,
        context,
      }),
    ).rejects.toThrow("[WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK]");
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK",
          path: "plugins.entries.beta-plugin.config.webSearch.apiKey",
        }),
      ]),
    );
  });

  it("uses bundled provider resolution for configured bundled providers", async () => {
    const bundledSpy = vi.mocked(bundledWebSearchProviders.resolveBundledPluginWebSearchProviders);

    const { metadata } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {
              enabled: true,
              provider: "beta",
            },
          },
        },
        plugins: {
          entries: {
            "beta-plugin": {
              enabled: true,
              config: {
                webSearch: {
                  apiKey: { source: "env", provider: "default", id: "BETA_PROVIDER_REF" },
                },
              },
            },
          },
        },
      }),
      env: {
        BETA_PROVIDER_REF: "beta-provider-key",
      },
    });

    expect(metadata.search.selectedProvider).toBe("beta");
    expect(bundledSpy).toHaveBeenCalled();
  });

  it("does not resolve web fetch provider SecretRef when web fetch is inactive", async () => {
    const resolveSpy = vi.spyOn(secretResolve, "resolveSecretRefValues");
    const { metadata, context } = await runRuntimeWebTools({
      config: asConfig({
        plugins: {
          entries: {
            spider: {
              config: {
                webFetch: {
                  apiKey: { source: "env", provider: "default", id: "MISSING_SPIDER_REF" },
                },
              },
            },
          },
        },
        tools: {
          web: {
            fetch: {
              enabled: false,
              provider: "spider",
            },
          },
        },
      }),
    });

    expectInactiveWebFetchProviderSecretRef({ resolveSpy, metadata, context });
  });

  it("keeps configured provider metadata and inactive warnings when search is disabled", async () => {
    const { metadata, context } = await runRuntimeWebTools({
      config: asConfig({
        tools: {
          web: {
            search: {
              enabled: false,
              provider: "beta",
            },
          },
        },
        plugins: {
          entries: {
            "beta-plugin": {
              enabled: true,
              config: {
                webSearch: {
                  apiKey: { source: "env", provider: "default", id: "BETA_PROVIDER_REF" },
                },
              },
            },
          },
        },
      }),
    });

    expect(metadata.search.providerConfigured).toBe("beta");
    expect(metadata.search.providerSource).toBe("configured");
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SECRETS_REF_IGNORED_INACTIVE_SURFACE",
          path: "plugins.entries.beta-plugin.config.webSearch.apiKey",
        }),
      ]),
    );
  });

  it("does not auto-enable search when tools.web.search is absent", async () => {
    const { metadata } = await runRuntimeWebTools({
      config: asConfig({}),
    });

    expect(metadata.search.providerSource).toBe("none");
    expect(metadata.search.selectedProvider).toBeUndefined();
  });

  it("uses env fallback for unresolved web fetch provider SecretRef when active", async () => {
    const { metadata, resolvedConfig, context } = await runRuntimeWebTools({
      config: asConfig({
        plugins: {
          entries: {
            spider: {
              config: {
                webFetch: {
                  apiKey: { source: "env", provider: "default", id: "MISSING_SPIDER_REF" },
                },
              },
            },
          },
        },
        tools: {
          web: {
            fetch: {
              provider: "spider",
            },
          },
        },
      }),
      env: {
        SPIDER_API_KEY: "spider-fallback-key", // pragma: allowlist secret
      },
    });

    expect(metadata.fetch.selectedProvider).toBe("spider");
    expect(metadata.fetch.selectedProviderKeySource).toBe("env");
    expect(
      (
        resolvedConfig.plugins?.entries?.spider?.config as
          | { webFetch?: { apiKey?: unknown } }
          | undefined
      )?.webFetch?.apiKey,
    ).toBe("spider-fallback-key");
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_FETCH_PROVIDER_KEY_UNRESOLVED_FALLBACK_USED",
          path: "plugins.entries.spider.config.webFetch.apiKey",
        }),
      ]),
    );
  });

  it("resolves plugin-owned web fetch SecretRefs without tools.web.fetch", async () => {
    const { metadata, resolvedConfig } = await runRuntimeWebTools({
      config: asConfig({
        plugins: {
          entries: {
            spider: {
              config: {
                webFetch: {
                  apiKey: { source: "env", provider: "default", id: "SPIDER_API_KEY" },
                },
              },
            },
          },
        },
      }),
      env: {
        SPIDER_API_KEY: "spider-runtime-key",
      },
    });

    expect(metadata.fetch.providerSource).toBe("auto-detect");
    expect(metadata.fetch.selectedProvider).toBe("spider");
    expect(metadata.fetch.selectedProviderKeySource).toBe("secretRef");
    expect(
      (
        resolvedConfig.plugins?.entries?.spider?.config as
          | { webFetch?: { apiKey?: unknown } }
          | undefined
      )?.webFetch?.apiKey,
    ).toBe("spider-runtime-key");
  });

  it("fails fast when active web fetch provider SecretRef is unresolved with no fallback", async () => {
    const sourceConfig = asConfig({
      plugins: {
        entries: {
          spider: {
            config: {
              webFetch: {
                apiKey: { source: "env", provider: "default", id: "MISSING_SPIDER_REF" },
              },
            },
          },
        },
      },
      tools: {
        web: {
          fetch: {
            provider: "spider",
          },
        },
      },
    });
    const resolvedConfig = structuredClone(sourceConfig);
    const context = createResolverContext({
      sourceConfig,
      env: {},
    });

    await expect(
      resolveRuntimeWebTools({
        sourceConfig,
        resolvedConfig,
        context,
      }),
    ).rejects.toThrow("[WEB_FETCH_PROVIDER_KEY_UNRESOLVED_NO_FALLBACK]");
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_FETCH_PROVIDER_KEY_UNRESOLVED_NO_FALLBACK",
          path: "plugins.entries.spider.config.webFetch.apiKey",
        }),
      ]),
    );
  });

  it("rejects env SecretRefs for web fetch provider keys outside provider allowlists", async () => {
    const sourceConfig = asConfig({
      plugins: {
        entries: {
          spider: {
            config: {
              webFetch: {
                apiKey: { source: "env", provider: "default", id: "AWS_SECRET_ACCESS_KEY" },
              },
            },
          },
        },
      },
      tools: {
        web: {
          fetch: {
            provider: "spider",
          },
        },
      },
    });
    const resolvedConfig = structuredClone(sourceConfig);
    const context = createResolverContext({
      sourceConfig,
      env: {
        AWS_SECRET_ACCESS_KEY: "not-allowed",
      },
    });

    await expect(
      resolveRuntimeWebTools({
        sourceConfig,
        resolvedConfig,
        context,
      }),
    ).rejects.toThrow("[WEB_FETCH_PROVIDER_KEY_UNRESOLVED_NO_FALLBACK]");
    expect(context.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "WEB_FETCH_PROVIDER_KEY_UNRESOLVED_NO_FALLBACK",
          path: "plugins.entries.spider.config.webFetch.apiKey",
          message: expect.stringContaining(
            'SecretRef env var "AWS_SECRET_ACCESS_KEY" is not allowed.',
          ),
        }),
      ]),
    );
  });

  it("keeps web fetch provider discovery bundled-only during runtime secret resolution", async () => {
    const bundledSpy = vi.mocked(bundledWebFetchProviders.resolveBundledPluginWebFetchProviders);

    const { metadata } = await runRuntimeWebTools({
      config: asConfig({
        plugins: {
          load: {
            paths: ["/tmp/malicious-plugin"],
          },
          entries: {
            spider: {
              enabled: true,
              config: {
                webFetch: {
                  apiKey: "spider-config-key",
                },
              },
            },
          },
        },
        tools: {
          web: {
            fetch: {
              provider: "spider",
            },
          },
        },
      }),
    });

    expect(metadata.fetch.selectedProvider).toBe("spider");
    expect(bundledSpy).toHaveBeenCalled();
  });
});
