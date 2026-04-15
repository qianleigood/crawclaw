import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import type { PluginWebFetchProviderEntry } from "../plugins/types.js";
import type { RuntimeWebFetchMetadata } from "../secrets/runtime-web-tools.types.js";

type TestPluginWebFetchConfig = {
  webFetch?: {
    apiKey?: unknown;
  };
};

const { resolveBundledPluginWebFetchProvidersMock, resolveRuntimeWebFetchProvidersMock } =
  vi.hoisted(() => ({
    resolveBundledPluginWebFetchProvidersMock: vi.fn<() => PluginWebFetchProviderEntry[]>(() => []),
    resolveRuntimeWebFetchProvidersMock: vi.fn<() => PluginWebFetchProviderEntry[]>(() => []),
  }));

vi.mock("../plugins/web-fetch-providers.js", () => ({
  resolveBundledPluginWebFetchProviders: resolveBundledPluginWebFetchProvidersMock,
}));

vi.mock("../plugins/web-fetch-providers.runtime.js", () => ({
  resolvePluginWebFetchProviders: resolveRuntimeWebFetchProvidersMock,
  resolveRuntimeWebFetchProviders: resolveRuntimeWebFetchProvidersMock,
}));

function createProvider(params: {
  pluginId: string;
  id: string;
  credentialPath: string;
  autoDetectOrder?: number;
  requiresCredential?: boolean;
  getCredentialValue?: PluginWebFetchProviderEntry["getCredentialValue"];
  getConfiguredCredentialValue?: PluginWebFetchProviderEntry["getConfiguredCredentialValue"];
  createTool?: PluginWebFetchProviderEntry["createTool"];
}): PluginWebFetchProviderEntry {
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

describe("web fetch runtime", () => {
  let resolveWebFetchDefinition: typeof import("./runtime.js").resolveWebFetchDefinition;
  let clearSecretsRuntimeSnapshot: typeof import("../secrets/runtime.js").clearSecretsRuntimeSnapshot;

  beforeAll(async () => {
    ({ resolveWebFetchDefinition } = await import("./runtime.js"));
    ({ clearSecretsRuntimeSnapshot } = await import("../secrets/runtime.js"));
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
    resolveBundledPluginWebFetchProvidersMock.mockReset();
    resolveRuntimeWebFetchProvidersMock.mockReset();
    resolveBundledPluginWebFetchProvidersMock.mockReturnValue([]);
    resolveRuntimeWebFetchProvidersMock.mockReturnValue([]);
  });

  afterEach(() => {
    clearSecretsRuntimeSnapshot();
  });

  it("does not auto-detect providers from plugin-owned env SecretRefs without runtime metadata", () => {
    const provider = createProvider({
      pluginId: "hosted-fetch",
      id: "hosted",
      credentialPath: "plugins.entries.hosted-fetch.config.webFetch.apiKey",
      autoDetectOrder: 1,
      getConfiguredCredentialValue: (config) => {
        const pluginConfig = config?.plugins?.entries?.["hosted-fetch"]?.config as
          | TestPluginWebFetchConfig
          | undefined;
        return pluginConfig?.webFetch?.apiKey;
      },
    });
    resolveBundledPluginWebFetchProvidersMock.mockReturnValue([provider]);

    const config: CrawClawConfig = {
      plugins: {
        entries: {
          "hosted-fetch": {
            enabled: true,
            config: {
              webFetch: {
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "AWS_SECRET_ACCESS_KEY",
                },
              },
            },
          },
        },
      },
    };

    vi.stubEnv("HOSTED_API_KEY", "");

    expect(resolveWebFetchDefinition({ config })).toBeNull();
  });

  it("prefers the runtime-selected provider when metadata is available", async () => {
    const provider = createProvider({
      pluginId: "scrapling-fetch",
      id: "scrapling",
      credentialPath: "plugins.entries.scrapling-fetch.config.webFetch.apiKey",
      autoDetectOrder: 0,
      requiresCredential: false,
      createTool: ({ runtimeMetadata }) => ({
        description: "scrapling",
        parameters: {},
        execute: async (args) => ({
          ...args,
          provider: runtimeMetadata?.selectedProvider ?? "scrapling",
        }),
      }),
    });
    resolveBundledPluginWebFetchProvidersMock.mockReturnValue([provider]);
    resolveRuntimeWebFetchProvidersMock.mockReturnValue([provider]);

    const runtimeWebFetch: RuntimeWebFetchMetadata = {
      providerSource: "auto-detect",
      selectedProvider: "scrapling",
      selectedProviderKeySource: "missing",
      diagnostics: [],
    };

    const resolved = resolveWebFetchDefinition({
      config: {},
      runtimeWebFetch,
      preferRuntimeProviders: true,
    });

    expect(resolved?.provider.id).toBe("scrapling");
    await expect(
      resolved?.definition.execute({
        url: "https://example.com",
        extractMode: "markdown",
        maxChars: 1000,
      }),
    ).resolves.toEqual({
      url: "https://example.com",
      extractMode: "markdown",
      maxChars: 1000,
      provider: "scrapling",
    });
  });

  it("auto-detects providers from provider-declared env vars", () => {
    const provider = createProvider({
      pluginId: "hosted-fetch",
      id: "hosted",
      credentialPath: "plugins.entries.hosted-fetch.config.webFetch.apiKey",
      autoDetectOrder: 1,
    });
    resolveBundledPluginWebFetchProvidersMock.mockReturnValue([provider]);
    vi.stubEnv("HOSTED_API_KEY", "hosted-env-key");

    const resolved = resolveWebFetchDefinition({
      config: {},
    });

    expect(resolved?.provider.id).toBe("hosted");
  });

  it("prefers bundled scrapling as the default provider even when api-backed providers are configured", () => {
    const scrapling = createProvider({
      pluginId: "scrapling-fetch",
      id: "scrapling",
      credentialPath: "plugins.entries.scrapling-fetch.config.webFetch.apiKey",
      autoDetectOrder: 0,
      requiresCredential: false,
    });
    const hosted = createProvider({
      pluginId: "hosted-fetch",
      id: "hosted",
      credentialPath: "plugins.entries.hosted-fetch.config.webFetch.apiKey",
      autoDetectOrder: 50,
      getConfiguredCredentialValue: () => "hosted-key",
    });
    resolveBundledPluginWebFetchProvidersMock.mockReturnValue([hosted, scrapling]);

    const resolved = resolveWebFetchDefinition({
      config: {},
    });

    expect(resolved?.provider.id).toBe("scrapling");
  });

  it("keeps honoring an explicit configured provider over the default scrapling path", () => {
    const scrapling = createProvider({
      pluginId: "scrapling-fetch",
      id: "scrapling",
      credentialPath: "plugins.entries.scrapling-fetch.config.webFetch.apiKey",
      autoDetectOrder: 0,
      requiresCredential: false,
    });
    const hosted = createProvider({
      pluginId: "hosted-fetch",
      id: "hosted",
      credentialPath: "plugins.entries.hosted-fetch.config.webFetch.apiKey",
      autoDetectOrder: 50,
      getConfiguredCredentialValue: () => "hosted-key",
    });
    resolveBundledPluginWebFetchProvidersMock.mockReturnValue([hosted, scrapling]);

    const resolved = resolveWebFetchDefinition({
      config: {
        tools: {
          web: {
            fetch: {
              provider: "hosted",
            },
          },
        },
      } as CrawClawConfig,
    });

    expect(resolved?.provider.id).toBe("hosted");
  });

  it("falls back to auto-detect when the configured provider is invalid", () => {
    const provider = createProvider({
      pluginId: "scrapling-fetch",
      id: "scrapling",
      credentialPath: "plugins.entries.scrapling-fetch.config.webFetch.apiKey",
      autoDetectOrder: 0,
      requiresCredential: false,
    });
    resolveBundledPluginWebFetchProvidersMock.mockReturnValue([provider]);

    const resolved = resolveWebFetchDefinition({
      config: {
        tools: {
          web: {
            fetch: {
              provider: "does-not-exist",
            },
          },
        },
      } as CrawClawConfig,
    });

    expect(resolved?.provider.id).toBe("scrapling");
  });

  it("keeps sandboxed web fetch on bundled providers even when runtime providers are preferred", () => {
    const bundled = createProvider({
      pluginId: "scrapling-fetch",
      id: "scrapling",
      credentialPath: "plugins.entries.scrapling-fetch.config.webFetch.apiKey",
      autoDetectOrder: 0,
      requiresCredential: false,
    });
    const runtimeOnly = createProvider({
      pluginId: "third-party-fetch",
      id: "thirdparty",
      credentialPath: "plugins.entries.third-party-fetch.config.webFetch.apiKey",
      autoDetectOrder: 0,
      getConfiguredCredentialValue: () => "runtime-key",
    });
    resolveBundledPluginWebFetchProvidersMock.mockReturnValue([bundled]);
    resolveRuntimeWebFetchProvidersMock.mockReturnValue([runtimeOnly]);

    const resolved = resolveWebFetchDefinition({
      config: {},
      sandboxed: true,
      preferRuntimeProviders: true,
    });

    expect(resolved?.provider.id).toBe("scrapling");
  });

  it("keeps non-sandboxed web fetch on bundled providers even when runtime providers are preferred", () => {
    const bundled = createProvider({
      pluginId: "scrapling-fetch",
      id: "scrapling",
      credentialPath: "plugins.entries.scrapling-fetch.config.webFetch.apiKey",
      autoDetectOrder: 0,
      requiresCredential: false,
    });
    const runtimeOnly = createProvider({
      pluginId: "third-party-fetch",
      id: "thirdparty",
      credentialPath: "plugins.entries.third-party-fetch.config.webFetch.apiKey",
      autoDetectOrder: 0,
      getConfiguredCredentialValue: () => "runtime-key",
    });
    resolveBundledPluginWebFetchProvidersMock.mockReturnValue([bundled]);
    resolveRuntimeWebFetchProvidersMock.mockReturnValue([runtimeOnly]);

    const resolved = resolveWebFetchDefinition({
      config: {},
      sandboxed: false,
      preferRuntimeProviders: true,
    });

    expect(resolved?.provider.id).toBe("scrapling");
  });
});
