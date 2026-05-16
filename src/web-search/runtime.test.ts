import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import type { PluginWebSearchProviderEntry } from "../plugins/types.js";

type TestPluginWebSearchConfig = {
  webSearch?: {
    baseUrl?: unknown;
  };
};

const { resolveBundledPluginWebSearchProvidersMock, resolveRuntimeWebSearchProvidersMock } =
  vi.hoisted(() => ({
    resolveBundledPluginWebSearchProvidersMock: vi.fn<() => PluginWebSearchProviderEntry[]>(
      () => [],
    ),
    resolveRuntimeWebSearchProvidersMock: vi.fn<() => PluginWebSearchProviderEntry[]>(() => []),
  }));

vi.mock("../plugins/web-search-providers.js", () => ({
  resolveBundledPluginWebSearchProviders: resolveBundledPluginWebSearchProvidersMock,
}));

vi.mock("../plugins/web-search-providers.runtime.js", () => ({
  resolvePluginWebSearchProviders: resolveRuntimeWebSearchProvidersMock,
  resolveRuntimeWebSearchProviders: resolveRuntimeWebSearchProvidersMock,
}));

function createProvider(params: {
  pluginId: string;
  id: string;
  credentialPath: string;
  autoDetectOrder?: number;
  requiresCredential?: boolean;
  getCredentialValue?: PluginWebSearchProviderEntry["getCredentialValue"];
  getConfiguredCredentialValue?: PluginWebSearchProviderEntry["getConfiguredCredentialValue"];
  createTool?: PluginWebSearchProviderEntry["createTool"];
}): PluginWebSearchProviderEntry {
  return {
    pluginId: params.pluginId,
    id: params.id,
    label: params.id,
    hint: `${params.id} runtime provider`,
    envVars: [`${params.id.toUpperCase()}_API_KEY`],
    placeholder: `${params.id}-...`,
    signupUrl: `https://example.com/${params.id}`,
    credentialPath: params.credentialPath,
    autoDetectOrder: params.autoDetectOrder,
    requiresCredential: params.requiresCredential,
    getCredentialValue: params.getCredentialValue ?? (() => undefined),
    setCredentialValue: () => {},
    getConfiguredCredentialValue: params.getConfiguredCredentialValue,
    createTool:
      params.createTool ??
      (() => ({
        description: params.id,
        parameters: {},
        execute: async (args) => ({ ...args, provider: params.id }),
      })),
  };
}

describe("web search runtime", () => {
  let runWebSearch: typeof import("./runtime.js").runWebSearch;
  let activateSecretsRuntimeSnapshot: typeof import("../secrets/runtime.js").activateSecretsRuntimeSnapshot;
  let clearSecretsRuntimeSnapshot: typeof import("../secrets/runtime.js").clearSecretsRuntimeSnapshot;

  beforeAll(async () => {
    ({ runWebSearch } = await import("./runtime.js"));
    ({ activateSecretsRuntimeSnapshot, clearSecretsRuntimeSnapshot } =
      await import("../secrets/runtime.js"));
  });

  beforeEach(() => {
    resolveBundledPluginWebSearchProvidersMock.mockReset();
    resolveRuntimeWebSearchProvidersMock.mockReset();
    resolveBundledPluginWebSearchProvidersMock.mockReturnValue([]);
    resolveRuntimeWebSearchProvidersMock.mockReturnValue([]);
  });

  afterEach(() => {
    clearSecretsRuntimeSnapshot();
  });

  it("executes searches through the active plugin registry", async () => {
    resolveRuntimeWebSearchProvidersMock.mockReturnValue([
      createProvider({
        pluginId: "searxng",
        id: "searxng",
        credentialPath: "plugins.entries.searxng.config.webSearch.baseUrl",
        autoDetectOrder: 1,
        requiresCredential: false,
        createTool: () => ({
          description: "searxng",
          parameters: {},
          execute: async (args) => ({ ...args, ok: true }),
        }),
      }),
    ]);

    await expect(
      runWebSearch({
        config: {},
        args: { query: "hello" },
      }),
    ).resolves.toEqual({
      provider: "searxng",
      result: { query: "hello", ok: true },
    });
  });

  it("uses searxng from canonical plugin-owned config", async () => {
    const provider = createProvider({
      pluginId: "searxng",
      id: "searxng",
      credentialPath: "plugins.entries.searxng.config.webSearch.baseUrl",
      autoDetectOrder: 1,
      getConfiguredCredentialValue: (config) => {
        const pluginConfig = config?.plugins?.entries?.["searxng"]?.config as
          | TestPluginWebSearchConfig
          | undefined;
        return pluginConfig?.webSearch?.baseUrl;
      },
      createTool: () => ({
        description: "searxng",
        parameters: {},
        execute: async (args) => ({ ...args, ok: true }),
      }),
    });
    resolveRuntimeWebSearchProvidersMock.mockReturnValue([provider]);
    resolveBundledPluginWebSearchProvidersMock.mockReturnValue([provider]);

    const config: CrawClawConfig = {
      plugins: {
        entries: {
          searxng: {
            enabled: true,
            config: {
              webSearch: {
                baseUrl: "http://127.0.0.1:3210",
              },
            },
          },
        },
      },
    };

    await expect(
      runWebSearch({
        config,
        args: { query: "hello" },
      }),
    ).resolves.toEqual({
      provider: "searxng",
      result: { query: "hello", ok: true },
    });
  });

  it("treats non-env SecretRefs as configured credentials for searxng", async () => {
    const provider = createProvider({
      pluginId: "searxng",
      id: "searxng",
      credentialPath: "plugins.entries.searxng.config.webSearch.baseUrl",
      autoDetectOrder: 1,
      getConfiguredCredentialValue: (config) => {
        const pluginConfig = config?.plugins?.entries?.["searxng"]?.config as
          | TestPluginWebSearchConfig
          | undefined;
        return pluginConfig?.webSearch?.baseUrl;
      },
      createTool: () => ({
        description: "searxng",
        parameters: {},
        execute: async (args) => ({ ...args, ok: true }),
      }),
    });
    resolveRuntimeWebSearchProvidersMock.mockReturnValue([provider]);
    resolveBundledPluginWebSearchProvidersMock.mockReturnValue([provider]);

    const config: CrawClawConfig = {
      plugins: {
        entries: {
          searxng: {
            enabled: true,
            config: {
              webSearch: {
                baseUrl: {
                  source: "file",
                  provider: "vault",
                  id: "/providers/searxng/baseUrl",
                },
              },
            },
          },
        },
      },
    };

    await expect(
      runWebSearch({
        config,
        args: { query: "hello" },
      }),
    ).resolves.toEqual({
      provider: "searxng",
      result: { query: "hello", ok: true },
    });
  });

  it("falls back to searxng when no credentials are available", async () => {
    resolveRuntimeWebSearchProvidersMock.mockReturnValue([
      createProvider({
        pluginId: "searxng",
        id: "searxng",
        credentialPath: "",
        autoDetectOrder: 100,
        requiresCredential: false,
      }),
    ]);

    await expect(
      runWebSearch({
        config: {},
        args: { query: "fallback" },
      }),
    ).resolves.toEqual({
      provider: "searxng",
      result: { query: "fallback", provider: "searxng" },
    });
  });

  it("ignores non-searxng runtime selections", async () => {
    resolveRuntimeWebSearchProvidersMock.mockReturnValue([
      createProvider({
        pluginId: "searxng",
        id: "searxng",
        credentialPath: "plugins.entries.searxng.config.webSearch.baseUrl",
        autoDetectOrder: 1,
        requiresCredential: false,
        createTool: ({ runtimeMetadata }) => ({
          description: "searxng",
          parameters: {},
          execute: async (args) => ({
            ...args,
            provider: "searxng",
            runtimeSelectedProvider: runtimeMetadata?.selectedProvider,
          }),
        }),
      }),
      createProvider({
        pluginId: "beta-search",
        id: "beta",
        credentialPath: "tools.web.search.beta.apiKey",
        autoDetectOrder: 2,
        getCredentialValue: () => "beta-configured",
        createTool: ({ runtimeMetadata }) => ({
          description: "beta",
          parameters: {},
          execute: async (args) => ({
            ...args,
            provider: "beta",
            runtimeSelectedProvider: runtimeMetadata?.selectedProvider,
          }),
        }),
      }),
    ]);

    activateSecretsRuntimeSnapshot({
      sourceConfig: {},
      config: {},
      runtimeConfig: {},
      authStores: [],
      warnings: [],
      webTools: {
        search: {
          providerSource: "auto-detect",
          selectedProvider: "beta",
          diagnostics: [],
        },
        fetch: {
          providerSource: "none",
          diagnostics: [],
        },
        diagnostics: [],
      },
    });

    await expect(
      runWebSearch({
        config: {},
        args: { query: "runtime" },
      }),
    ).resolves.toEqual({
      provider: "searxng",
      result: { query: "runtime", provider: "searxng", runtimeSelectedProvider: "beta" },
    });
  });
});
