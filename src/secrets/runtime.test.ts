import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProfileStore } from "../agents/auth-profiles.js";
import type { CrawClawConfig } from "../config/config.js";
import type { PluginWebSearchProviderEntry } from "../plugins/types.js";

type WebProviderUnderTest = "alpha" | "beta" | "gamma" | "delta" | "epsilon";

const { resolveBundledPluginWebSearchProvidersMock, resolvePluginWebSearchProvidersMock } =
  vi.hoisted(() => ({
    resolveBundledPluginWebSearchProvidersMock: vi.fn(() => buildTestWebSearchProviders()),
    resolvePluginWebSearchProvidersMock: vi.fn(() => buildTestWebSearchProviders()),
  }));

vi.mock("../plugins/web-search-providers.js", () => ({
  resolveBundledPluginWebSearchProviders: resolveBundledPluginWebSearchProvidersMock,
}));

vi.mock("../plugins/web-search-providers.runtime.js", () => ({
  resolvePluginWebSearchProviders: resolvePluginWebSearchProvidersMock,
}));

function asConfig(value: unknown): CrawClawConfig {
  return value as CrawClawConfig;
}

function createTestProvider(params: {
  id: WebProviderUnderTest;
  pluginId: string;
  order: number;
}): PluginWebSearchProviderEntry {
  const credentialPath = `plugins.entries.${params.pluginId}.config.webSearch.apiKey`;
  const readSearchConfigKey = (searchConfig?: Record<string, unknown>): unknown => {
    const providerConfig =
      searchConfig?.[params.id] && typeof searchConfig[params.id] === "object"
        ? (searchConfig[params.id] as { apiKey?: unknown })
        : undefined;
    return providerConfig?.apiKey ?? searchConfig?.apiKey;
  };
  return {
    pluginId: params.pluginId,
    id: params.id,
    label: params.id,
    hint: `${params.id} test provider`,
    envVars: [`${params.id.toUpperCase()}_API_KEY`],
    placeholder: `${params.id}-...`,
    signupUrl: `https://example.com/${params.id}`,
    autoDetectOrder: params.order,
    credentialPath,
    inactiveSecretPaths: [credentialPath],
    getCredentialValue: readSearchConfigKey,
    setCredentialValue: (searchConfigTarget, value) => {
      const providerConfig =
        params.id === "alpha"
          ? searchConfigTarget
          : ((searchConfigTarget[params.id] ??= {}) as { apiKey?: unknown });
      providerConfig.apiKey = value;
    },
    getConfiguredCredentialValue: (config) =>
      (config?.plugins?.entries?.[params.pluginId]?.config as { webSearch?: { apiKey?: unknown } })
        ?.webSearch?.apiKey,
    setConfiguredCredentialValue: (configTarget, value) => {
      const plugins = (configTarget.plugins ??= {}) as { entries?: Record<string, unknown> };
      const entries = (plugins.entries ??= {});
      const entry = (entries[params.pluginId] ??= {}) as { config?: Record<string, unknown> };
      const config = (entry.config ??= {});
      const webSearch = (config.webSearch ??= {}) as { apiKey?: unknown };
      webSearch.apiKey = value;
    },
  };
}

function buildTestWebSearchProviders(): PluginWebSearchProviderEntry[] {
  return [
    createTestProvider({ id: "alpha", pluginId: "alpha", order: 10 }),
    createTestProvider({ id: "beta", pluginId: "beta-plugin", order: 20 }),
    createTestProvider({ id: "gamma", pluginId: "gamma-plugin", order: 30 }),
    createTestProvider({ id: "delta", pluginId: "delta-plugin", order: 40 }),
    createTestProvider({ id: "epsilon", pluginId: "epsilon", order: 50 }),
  ];
}

const OPENAI_ENV_KEY_REF = { source: "env", provider: "default", id: "OPENAI_API_KEY" } as const;

let clearConfigCache: typeof import("../config/config.js").clearConfigCache;
let clearRuntimeConfigSnapshot: typeof import("../config/config.js").clearRuntimeConfigSnapshot;
let activateSecretsRuntimeSnapshot: typeof import("./runtime.js").activateSecretsRuntimeSnapshot;
let clearSecretsRuntimeSnapshot: typeof import("./runtime.js").clearSecretsRuntimeSnapshot;
let getActiveRuntimeWebToolsMetadata: typeof import("./runtime.js").getActiveRuntimeWebToolsMetadata;
let prepareSecretsRuntimeSnapshot: typeof import("./runtime.js").prepareSecretsRuntimeSnapshot;

function createOpenAiFileModelsConfig(): NonNullable<CrawClawConfig["models"]> {
  return {
    providers: {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: { source: "file", provider: "default", id: "/providers/openai/apiKey" },
        models: [],
      },
    },
  };
}

function loadAuthStoreWithProfiles(profiles: AuthProfileStore["profiles"]): AuthProfileStore {
  return {
    version: 1,
    profiles,
  };
}

describe("secrets runtime snapshot", () => {
  beforeAll(async () => {
    ({ clearConfigCache, clearRuntimeConfigSnapshot } = await import("../config/config.js"));
    ({
      activateSecretsRuntimeSnapshot,
      clearSecretsRuntimeSnapshot,
      getActiveRuntimeWebToolsMetadata,
      prepareSecretsRuntimeSnapshot,
    } = await import("./runtime.js"));
  });

  beforeEach(() => {
    resolveBundledPluginWebSearchProvidersMock.mockReset();
    resolveBundledPluginWebSearchProvidersMock.mockReturnValue(buildTestWebSearchProviders());
    resolvePluginWebSearchProvidersMock.mockReset();
    resolvePluginWebSearchProvidersMock.mockReturnValue(buildTestWebSearchProviders());
  });

  afterEach(() => {
    clearSecretsRuntimeSnapshot();
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    resolveBundledPluginWebSearchProvidersMock.mockReset();
    resolvePluginWebSearchProvidersMock.mockReset();
  });

  it("resolves env refs for config and auth profiles", async () => {
    const config = asConfig({
      models: {
        providers: {
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
            headers: {
              Authorization: {
                source: "env",
                provider: "default",
                id: "OPENAI_PROVIDER_AUTH_HEADER",
              },
            },
            models: [],
          },
        },
      },
      skills: {
        entries: {
          "review-pr": {
            enabled: true,
            apiKey: { source: "env", provider: "default", id: "REVIEW_SKILL_API_KEY" },
          },
        },
      },
      talk: {
        providers: {
          acme: {
            apiKey: { source: "env", provider: "default", id: "TALK_PROVIDER_API_KEY" },
          },
        },
      },
      gateway: {
        mode: "remote",
        remote: {
          url: "wss://gateway.example",
          token: { source: "env", provider: "default", id: "REMOTE_GATEWAY_TOKEN" },
          password: { source: "env", provider: "default", id: "REMOTE_GATEWAY_PASSWORD" },
        },
      },
    });

    const snapshot = await prepareSecretsRuntimeSnapshot({
      config,
      env: {
        OPENAI_API_KEY: "sk-env-openai", // pragma: allowlist secret
        OPENAI_PROVIDER_AUTH_HEADER: "Bearer sk-env-header", // pragma: allowlist secret
        GITHUB_TOKEN: "ghp-env-token", // pragma: allowlist secret
        REVIEW_SKILL_API_KEY: "sk-skill-ref", // pragma: allowlist secret
        MEMORY_REMOTE_API_KEY: "mem-ref-key", // pragma: allowlist secret
        TALK_PROVIDER_API_KEY: "talk-provider-ref-key", // pragma: allowlist secret
        REMOTE_GATEWAY_TOKEN: "remote-token-ref",
        REMOTE_GATEWAY_PASSWORD: "remote-password-ref", // pragma: allowlist secret
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () =>
        loadAuthStoreWithProfiles({
          "openai:default": {
            type: "api_key",
            provider: "openai",
            key: "old-openai",
            keyRef: OPENAI_ENV_KEY_REF,
          },
          "github-copilot:default": {
            type: "token",
            provider: "github-copilot",
            token: "old-gh",
            tokenRef: { source: "env", provider: "default", id: "GITHUB_TOKEN" },
          },
          "openai:inline": {
            type: "api_key",
            provider: "openai",
            key: "${OPENAI_API_KEY}",
          },
        }),
    });

    expect(snapshot.runtimeConfig.models?.providers?.openai?.apiKey).toBe("sk-env-openai");
    expect(snapshot.runtimeConfig.models?.providers?.openai?.headers?.Authorization).toBe(
      "Bearer sk-env-header",
    );
    expect(snapshot.runtimeConfig.skills?.entries?.["review-pr"]?.apiKey).toBe("sk-skill-ref");
    expect(snapshot.runtimeConfig.talk?.providers?.acme?.apiKey).toBe("talk-provider-ref-key");
    expect(snapshot.runtimeConfig.gateway?.remote?.token).toBe("remote-token-ref");
    expect(snapshot.runtimeConfig.gateway?.remote?.password).toBe("remote-password-ref");
    expect(snapshot.authStores[0]?.store.profiles["openai:default"]).toMatchObject({
      type: "api_key",
      key: "sk-env-openai",
    });
    expect(snapshot.authStores[0]?.store.profiles["github-copilot:default"]).toMatchObject({
      type: "token",
      token: "ghp-env-token",
    });
    expect(snapshot.authStores[0]?.store.profiles["openai:inline"]).toMatchObject({
      type: "api_key",
      key: "sk-env-openai",
    });
    // After normalization, inline SecretRef string should be promoted to keyRef
    expect(
      (snapshot.authStores[0].store.profiles["openai:inline"] as Record<string, unknown>).keyRef,
    ).toEqual({ source: "env", provider: "default", id: "OPENAI_API_KEY" });
  });

  it("can skip auth-profile SecretRef resolution when includeAuthStoreRefs is false", async () => {
    const missingEnvVar = `CRAWCLAW_MISSING_AUTH_PROFILE_SECRET_${Date.now()}`;
    delete process.env[missingEnvVar];

    const loadAuthStore = () =>
      loadAuthStoreWithProfiles({
        "custom:token": {
          type: "token",
          provider: "custom",
          tokenRef: { source: "env", provider: "default", id: missingEnvVar },
        },
      });

    await expect(
      prepareSecretsRuntimeSnapshot({
        config: asConfig({}),
        env: {},
        agentDirs: ["/tmp/crawclaw-agent-main"],
        loadAuthStore,
      }),
    ).rejects.toThrow(`Environment variable "${missingEnvVar}" is missing or empty.`);

    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({}),
      env: {},
      includeAuthStoreRefs: false,
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore,
    });

    expect(snapshot.authStores).toEqual([]);
  });

  it("normalizes inline SecretRef object on token to tokenRef", async () => {
    const config: CrawClawConfig = { models: {}, secrets: {} };
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config,
      env: { MY_TOKEN: "resolved-token-value" },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () =>
        loadAuthStoreWithProfiles({
          "custom:inline-token": {
            type: "token",
            provider: "custom",
            token: { source: "env", provider: "default", id: "MY_TOKEN" } as unknown as string,
          },
        }),
    });

    const profile = snapshot.authStores[0]?.store.profiles["custom:inline-token"] as Record<
      string,
      unknown
    >;
    // tokenRef should be set from the inline SecretRef
    expect(profile.tokenRef).toEqual({ source: "env", provider: "default", id: "MY_TOKEN" });
    // token should be resolved to the actual value after activation
    activateSecretsRuntimeSnapshot(snapshot);
    expect(profile.token).toBe("resolved-token-value");
  });

  it("normalizes inline SecretRef object on key to keyRef", async () => {
    const config: CrawClawConfig = { models: {}, secrets: {} };
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config,
      env: { MY_KEY: "resolved-key-value" },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () =>
        loadAuthStoreWithProfiles({
          "custom:inline-key": {
            type: "api_key",
            provider: "custom",
            key: { source: "env", provider: "default", id: "MY_KEY" } as unknown as string,
          },
        }),
    });

    const profile = snapshot.authStores[0]?.store.profiles["custom:inline-key"] as Record<
      string,
      unknown
    >;
    // keyRef should be set from the inline SecretRef
    expect(profile.keyRef).toEqual({ source: "env", provider: "default", id: "MY_KEY" });
    // key should be resolved to the actual value after activation
    activateSecretsRuntimeSnapshot(snapshot);
    expect(profile.key).toBe("resolved-key-value");
  });

  it("keeps explicit keyRef when inline key SecretRef is also present", async () => {
    const config: CrawClawConfig = { models: {}, secrets: {} };
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config,
      env: {
        PRIMARY_KEY: "primary-key-value",
        SHADOW_KEY: "shadow-key-value",
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () =>
        loadAuthStoreWithProfiles({
          "custom:explicit-keyref": {
            type: "api_key",
            provider: "custom",
            keyRef: { source: "env", provider: "default", id: "PRIMARY_KEY" },
            key: { source: "env", provider: "default", id: "SHADOW_KEY" } as unknown as string,
          },
        }),
    });

    const profile = snapshot.authStores[0]?.store.profiles["custom:explicit-keyref"] as Record<
      string,
      unknown
    >;
    expect(profile.keyRef).toEqual({ source: "env", provider: "default", id: "PRIMARY_KEY" });
    activateSecretsRuntimeSnapshot(snapshot);
    expect(profile.key).toBe("primary-key-value");
  });

  it("treats non-selected web search provider refs as inactive", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({
        tools: {
          web: {
            search: {
              enabled: true,
              provider: "alpha",
            },
          },
        },
        plugins: {
          entries: {
            alpha: {
              config: {
                webSearch: {
                  apiKey: { source: "env", provider: "default", id: "WEB_SEARCH_ALPHA_API_KEY" },
                },
              },
            },
            "gamma-plugin": {
              config: {
                webSearch: {
                  apiKey: { source: "env", provider: "default", id: "MISSING_GAMMA_API_KEY" },
                },
              },
            },
          },
        },
      }),
      env: {
        WEB_SEARCH_ALPHA_API_KEY: "web-search-alpha-ref", // pragma: allowlist secret
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    const alphaWebSearchConfig = snapshot.runtimeConfig.plugins?.entries?.alpha?.config as
      | { webSearch?: { apiKey?: unknown } }
      | undefined;
    expect(alphaWebSearchConfig?.webSearch?.apiKey).toBe("web-search-alpha-ref");
    const gammaPluginWebSearchConfig = snapshot.runtimeConfig.plugins?.entries?.["gamma-plugin"]
      ?.config as { webSearch?: { apiKey?: unknown } } | undefined;
    expect(gammaPluginWebSearchConfig?.webSearch?.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "MISSING_GAMMA_API_KEY",
    });
    expect(snapshot.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SECRETS_REF_IGNORED_INACTIVE_SURFACE",
          path: "plugins.entries.gamma-plugin.config.webSearch.apiKey",
        }),
      ]),
    );
  });

  it("keeps non-selected provider refs inactive in web search auto mode", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
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
              config: {
                webSearch: {
                  apiKey: { source: "env", provider: "default", id: "WEB_SEARCH_ALPHA_API_KEY" },
                },
              },
            },
            "beta-plugin": {
              config: {
                webSearch: {
                  apiKey: {
                    source: "env",
                    provider: "default",
                    id: "WEB_SEARCH_BETA_API_KEY",
                  },
                },
              },
            },
          },
        },
      }),
      env: {
        WEB_SEARCH_ALPHA_API_KEY: "web-search-alpha-ref", // pragma: allowlist secret
        WEB_SEARCH_BETA_API_KEY: "web-search-beta-ref", // pragma: allowlist secret
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    const alphaWebSearchConfig = snapshot.runtimeConfig.plugins?.entries?.alpha?.config as
      | { webSearch?: { apiKey?: unknown } }
      | undefined;
    expect(alphaWebSearchConfig?.webSearch?.apiKey).toBe("web-search-alpha-ref");
    const betaPluginWebSearchConfig = snapshot.runtimeConfig.plugins?.entries?.["beta-plugin"]
      ?.config as { webSearch?: { apiKey?: unknown } } | undefined;
    expect(betaPluginWebSearchConfig?.webSearch?.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "WEB_SEARCH_BETA_API_KEY",
    });
    expect(snapshot.webTools.search.selectedProvider).toBe("alpha");
    expect(snapshot.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SECRETS_REF_IGNORED_INACTIVE_SURFACE",
          path: "plugins.entries.beta-plugin.config.webSearch.apiKey",
        }),
      ]),
    );
  });

  it("resolves selected web search provider ref even when provider config is disabled", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
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
              config: {
                webSearch: {
                  enabled: false,
                  apiKey: {
                    source: "env",
                    provider: "default",
                    id: "WEB_SEARCH_BETA_API_KEY",
                  },
                },
              },
            },
          },
        },
      }),
      env: {
        WEB_SEARCH_BETA_API_KEY: "web-search-beta-ref", // pragma: allowlist secret
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });
    const resolvedBetaWebSearchConfig = snapshot.runtimeConfig.plugins?.entries?.["beta-plugin"]
      ?.config as { webSearch?: { apiKey?: unknown } } | undefined;
    expect(resolvedBetaWebSearchConfig?.webSearch?.apiKey).toBe("web-search-beta-ref");
    expect(snapshot.warnings.map((warning) => warning.path)).not.toContain(
      "plugins.entries.beta-plugin.config.webSearch.apiKey",
    );
  });

  it("fails fast at startup when selected web search provider ref is unresolved", async () => {
    await expect(
      prepareSecretsRuntimeSnapshot({
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
                config: {
                  webSearch: {
                    apiKey: {
                      source: "env",
                      provider: "default",
                      id: "MISSING_WEB_SEARCH_BETA_API_KEY",
                    },
                  },
                },
              },
            },
          },
        }),
        env: {},
        agentDirs: ["/tmp/crawclaw-agent-main"],
        loadAuthStore: () => ({ version: 1, profiles: {} }),
      }),
    ).rejects.toThrow("[WEB_SEARCH_KEY_UNRESOLVED_NO_FALLBACK]");
  });

  it("exposes active runtime web tool metadata as a defensive clone", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({
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
              config: {
                webSearch: {
                  apiKey: {
                    source: "env",
                    provider: "default",
                    id: "WEB_SEARCH_BETA_API_KEY",
                  },
                },
              },
            },
          },
        },
      }),
      env: {
        WEB_SEARCH_BETA_API_KEY: "web-search-beta-ref", // pragma: allowlist secret
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    activateSecretsRuntimeSnapshot(snapshot);

    const first = getActiveRuntimeWebToolsMetadata();
    expect(first?.search.providerConfigured).toBe("beta");
    expect(first?.search.selectedProvider).toBe("beta");
    expect(first?.search.selectedProviderKeySource).toBe("secretRef");
    if (!first) {
      throw new Error("missing runtime web tools metadata");
    }
    first.search.providerConfigured = "alpha";
    first.search.selectedProvider = "alpha";

    const second = getActiveRuntimeWebToolsMetadata();
    expect(second?.search.providerConfigured).toBe("beta");
    expect(second?.search.selectedProvider).toBe("beta");
  });

  it("resolves file refs via configured file provider", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-secrets-file-provider-"));
    const secretsPath = path.join(root, "secrets.json");
    try {
      await fs.writeFile(
        secretsPath,
        JSON.stringify(
          {
            providers: {
              openai: {
                apiKey: "sk-from-file-provider", // pragma: allowlist secret
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.chmod(secretsPath, 0o600);

      const config = asConfig({
        secrets: {
          providers: {
            default: {
              source: "file",
              path: secretsPath,
              mode: "json",
            },
          },
          defaults: {
            file: "default",
          },
        },
        models: {
          providers: {
            openai: {
              baseUrl: "https://api.openai.com/v1",
              apiKey: { source: "file", provider: "default", id: "/providers/openai/apiKey" },
              models: [],
            },
          },
        },
      });

      const snapshot = await prepareSecretsRuntimeSnapshot({
        config,
        agentDirs: ["/tmp/crawclaw-agent-main"],
        loadAuthStore: () => ({ version: 1, profiles: {} }),
      });

      expect(snapshot.runtimeConfig.models?.providers?.openai?.apiKey).toBe(
        "sk-from-file-provider",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails when file provider payload is not a JSON object", async () => {
    if (process.platform === "win32") {
      return;
    }
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-secrets-file-provider-bad-"));
    const secretsPath = path.join(root, "secrets.json");
    try {
      await fs.writeFile(secretsPath, JSON.stringify(["not-an-object"]), "utf8");
      await fs.chmod(secretsPath, 0o600);

      await expect(
        prepareSecretsRuntimeSnapshot({
          config: asConfig({
            secrets: {
              providers: {
                default: {
                  source: "file",
                  path: secretsPath,
                  mode: "json",
                },
              },
            },
            models: {
              ...createOpenAiFileModelsConfig(),
            },
          }),
          agentDirs: ["/tmp/crawclaw-agent-main"],
          loadAuthStore: () => ({ version: 1, profiles: {} }),
        }),
      ).rejects.toThrow("payload is not a JSON object");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("skips inactive-surface refs and emits diagnostics", async () => {
    const config = asConfig({
      gateway: {
        auth: {
          mode: "token",
          password: { source: "env", provider: "default", id: "DISABLED_GATEWAY_PASSWORD" },
        },
      },
      tools: {
        web: {
          search: {
            enabled: false,
            apiKey: { source: "env", provider: "default", id: "DISABLED_WEB_SEARCH_API_KEY" },
          },
        },
      },
      plugins: {
        entries: {
          "beta-plugin": {
            config: {
              webSearch: {
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "DISABLED_WEB_SEARCH_BETA_API_KEY",
                },
              },
            },
          },
        },
      },
    });

    const snapshot = await prepareSecretsRuntimeSnapshot({
      config,
      env: {},
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    const ignoredInactiveWarnings = snapshot.warnings.filter(
      (warning) => warning.code === "SECRETS_REF_IGNORED_INACTIVE_SURFACE",
    );
    expect(ignoredInactiveWarnings).toHaveLength(6);
    expect(snapshot.warnings.map((warning) => warning.path)).toEqual(
      expect.arrayContaining([
        "gateway.auth.password",
        "plugins.entries.alpha.config.webSearch.apiKey",
        "plugins.entries.beta-plugin.config.webSearch.apiKey",
        "plugins.entries.gamma-plugin.config.webSearch.apiKey",
        "plugins.entries.delta-plugin.config.webSearch.apiKey",
        "plugins.entries.epsilon.config.webSearch.apiKey",
      ]),
    );
  });

  it("treats gateway.remote refs as inactive when local auth credentials are configured", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({
        gateway: {
          mode: "local",
          auth: {
            mode: "password",
            token: "local-token",
            password: "local-password", // pragma: allowlist secret
          },
          remote: {
            enabled: true,
            token: { source: "env", provider: "default", id: "MISSING_REMOTE_TOKEN" },
            password: { source: "env", provider: "default", id: "MISSING_REMOTE_PASSWORD" },
          },
        },
      }),
      env: {},
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    expect(snapshot.runtimeConfig.gateway?.remote?.token).toEqual({
      source: "env",
      provider: "default",
      id: "MISSING_REMOTE_TOKEN",
    });
    expect(snapshot.runtimeConfig.gateway?.remote?.password).toEqual({
      source: "env",
      provider: "default",
      id: "MISSING_REMOTE_PASSWORD",
    });
    expect(snapshot.warnings.map((warning) => warning.path)).toEqual(
      expect.arrayContaining(["gateway.remote.token", "gateway.remote.password"]),
    );
  });

  it("treats gateway.auth.password ref as active when mode is unset and no token is configured", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({
        gateway: {
          auth: {
            password: { source: "env", provider: "default", id: "GATEWAY_PASSWORD_REF" },
          },
        },
      }),
      env: {
        GATEWAY_PASSWORD_REF: "resolved-gateway-password", // pragma: allowlist secret
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    expect(snapshot.runtimeConfig.gateway?.auth?.password).toBe("resolved-gateway-password");
    expect(snapshot.warnings.map((warning) => warning.path)).not.toContain("gateway.auth.password");
  });

  it("treats gateway.auth.token ref as active when token mode is explicit", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({
        gateway: {
          auth: {
            mode: "token",
            token: { source: "env", provider: "default", id: "GATEWAY_TOKEN_REF" },
          },
        },
      }),
      env: {
        GATEWAY_TOKEN_REF: "resolved-gateway-token",
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    expect(snapshot.runtimeConfig.gateway?.auth?.token).toBe("resolved-gateway-token");
    expect(snapshot.warnings.map((warning) => warning.path)).not.toContain("gateway.auth.token");
  });

  it("treats gateway.auth.token ref as inactive when password mode is explicit", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({
        gateway: {
          auth: {
            mode: "password",
            token: { source: "env", provider: "default", id: "GATEWAY_TOKEN_REF" },
            password: "password-123", // pragma: allowlist secret
          },
        },
      }),
      env: {
        GATEWAY_TOKEN_REF: "resolved-gateway-token",
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    expect(snapshot.runtimeConfig.gateway?.auth?.token).toEqual({
      source: "env",
      provider: "default",
      id: "GATEWAY_TOKEN_REF",
    });
    expect(snapshot.warnings.map((warning) => warning.path)).toContain("gateway.auth.token");
  });

  it("fails when gateway.auth.token ref is active and unresolved", async () => {
    await expect(
      prepareSecretsRuntimeSnapshot({
        config: asConfig({
          gateway: {
            auth: {
              mode: "token",
              token: { source: "env", provider: "default", id: "MISSING_GATEWAY_TOKEN_REF" },
            },
          },
        }),
        env: {},
        agentDirs: ["/tmp/crawclaw-agent-main"],
        loadAuthStore: () => ({ version: 1, profiles: {} }),
      }),
    ).rejects.toThrow(/MISSING_GATEWAY_TOKEN_REF/i);
  });

  it("fails when an active exec ref id contains traversal segments", async () => {
    await expect(
      prepareSecretsRuntimeSnapshot({
        config: asConfig({
          talk: {
            providers: {
              acme: {
                apiKey: { source: "exec", provider: "vault", id: "a/../b" },
              },
            },
          },
          secrets: {
            providers: {
              vault: {
                source: "exec",
                command: process.execPath,
              },
            },
          },
        }),
        env: {},
        agentDirs: ["/tmp/crawclaw-agent-main"],
        loadAuthStore: () => ({ version: 1, profiles: {} }),
      }),
    ).rejects.toThrow(/must not include "\." or "\.\." path segments/i);
  });

  it("treats gateway.auth.password ref as inactive when auth mode is trusted-proxy", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({
        gateway: {
          auth: {
            mode: "trusted-proxy",
            password: { source: "env", provider: "default", id: "GATEWAY_PASSWORD_REF" },
          },
        },
      }),
      env: {
        GATEWAY_PASSWORD_REF: "resolved-gateway-password", // pragma: allowlist secret
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    expect(snapshot.runtimeConfig.gateway?.auth?.password).toEqual({
      source: "env",
      provider: "default",
      id: "GATEWAY_PASSWORD_REF",
    });
    expect(snapshot.warnings.map((warning) => warning.path)).toContain("gateway.auth.password");
  });

  it("treats gateway.auth.password ref as inactive when remote token is configured", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({
        gateway: {
          mode: "local",
          auth: {
            password: { source: "env", provider: "default", id: "GATEWAY_PASSWORD_REF" },
          },
          remote: {
            token: { source: "env", provider: "default", id: "REMOTE_GATEWAY_TOKEN" },
          },
        },
      }),
      env: {
        REMOTE_GATEWAY_TOKEN: "remote-token",
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    expect(snapshot.runtimeConfig.gateway?.auth?.password).toEqual({
      source: "env",
      provider: "default",
      id: "GATEWAY_PASSWORD_REF",
    });
    expect(snapshot.warnings.map((warning) => warning.path)).toContain("gateway.auth.password");
  });

  it.each(["none", "trusted-proxy"] as const)(
    "treats gateway.remote refs as inactive in local mode when auth mode is %s",
    async (mode) => {
      const snapshot = await prepareSecretsRuntimeSnapshot({
        config: asConfig({
          gateway: {
            mode: "local",
            auth: {
              mode,
            },
            remote: {
              token: { source: "env", provider: "default", id: "MISSING_REMOTE_TOKEN" },
              password: { source: "env", provider: "default", id: "MISSING_REMOTE_PASSWORD" },
            },
          },
        }),
        env: {},
        agentDirs: ["/tmp/crawclaw-agent-main"],
        loadAuthStore: () => ({ version: 1, profiles: {} }),
      });

      expect(snapshot.runtimeConfig.gateway?.remote?.token).toEqual({
        source: "env",
        provider: "default",
        id: "MISSING_REMOTE_TOKEN",
      });
      expect(snapshot.runtimeConfig.gateway?.remote?.password).toEqual({
        source: "env",
        provider: "default",
        id: "MISSING_REMOTE_PASSWORD",
      });
      expect(snapshot.warnings.map((warning) => warning.path)).toEqual(
        expect.arrayContaining(["gateway.remote.token", "gateway.remote.password"]),
      );
    },
  );

  it("treats gateway.remote.token ref as active in local mode when no local credentials are configured", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({
        gateway: {
          mode: "local",
          auth: {},
          remote: {
            enabled: true,
            token: { source: "env", provider: "default", id: "REMOTE_TOKEN" },
            password: { source: "env", provider: "default", id: "REMOTE_PASSWORD" },
          },
        },
      }),
      env: {
        REMOTE_TOKEN: "resolved-remote-token",
        REMOTE_PASSWORD: "resolved-remote-password", // pragma: allowlist secret
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    expect(snapshot.runtimeConfig.gateway?.remote?.token).toBe("resolved-remote-token");
    expect(snapshot.warnings.map((warning) => warning.path)).not.toContain("gateway.remote.token");
    expect(snapshot.warnings.map((warning) => warning.path)).toContain("gateway.remote.password");
  });

  it("treats gateway.remote.password ref as active in local mode when password can win", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({
        gateway: {
          mode: "local",
          auth: {},
          remote: {
            enabled: true,
            password: { source: "env", provider: "default", id: "REMOTE_PASSWORD" },
          },
        },
      }),
      env: {
        REMOTE_PASSWORD: "resolved-remote-password", // pragma: allowlist secret
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    expect(snapshot.runtimeConfig.gateway?.remote?.password).toBe("resolved-remote-password");
    expect(snapshot.warnings.map((warning) => warning.path)).not.toContain(
      "gateway.remote.password",
    );
  });

  it("treats gateway.remote refs as active when tailscale serve is enabled", async () => {
    const snapshot = await prepareSecretsRuntimeSnapshot({
      config: asConfig({
        gateway: {
          mode: "local",
          tailscale: { mode: "serve" },
          remote: {
            enabled: true,
            token: { source: "env", provider: "default", id: "REMOTE_GATEWAY_TOKEN" },
            password: { source: "env", provider: "default", id: "REMOTE_GATEWAY_PASSWORD" },
          },
        },
      }),
      env: {
        REMOTE_GATEWAY_TOKEN: "tailscale-remote-token",
        REMOTE_GATEWAY_PASSWORD: "tailscale-remote-password", // pragma: allowlist secret
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    expect(snapshot.runtimeConfig.gateway?.remote?.token).toBe("tailscale-remote-token");
    expect(snapshot.runtimeConfig.gateway?.remote?.password).toBe("tailscale-remote-password");
    expect(snapshot.warnings.map((warning) => warning.path)).not.toContain("gateway.remote.token");
    expect(snapshot.warnings.map((warning) => warning.path)).not.toContain(
      "gateway.remote.password",
    );
  });

  it("resolves SecretRef objects for active acpx MCP env vars", async () => {
    const config = asConfig({
      plugins: {
        entries: {
          acpx: {
            enabled: true,
            config: {
              mcpServers: {
                github: {
                  command: "npx",
                  env: {
                    GITHUB_TOKEN: {
                      source: "env",
                      provider: "default",
                      id: "GH_TOKEN_SECRET",
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const snapshot = await prepareSecretsRuntimeSnapshot({
      config,
      env: {
        GH_TOKEN_SECRET: "ghp-object-token",
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    const sourceEntries = snapshot.sourceConfig.plugins?.entries as Record<
      string,
      { config?: Record<string, unknown> }
    >;
    const sourceMcpServers = sourceEntries?.acpx?.config?.mcpServers as Record<
      string,
      { env?: Record<string, unknown> }
    >;
    const entries = snapshot.runtimeConfig.plugins?.entries as Record<
      string,
      { config?: Record<string, unknown> }
    >;
    const mcpServers = entries?.acpx?.config?.mcpServers as Record<
      string,
      { env?: Record<string, unknown> }
    >;

    expect(mcpServers?.github?.env?.GITHUB_TOKEN).toBe("ghp-object-token");
    expect(sourceMcpServers?.github?.env?.GITHUB_TOKEN).toEqual({
      source: "env",
      provider: "default",
      id: "GH_TOKEN_SECRET",
    });
  });

  it("resolves inline env-template refs for active acpx MCP env vars", async () => {
    const config = asConfig({
      plugins: {
        entries: {
          acpx: {
            enabled: true,
            config: {
              mcpServers: {
                github: {
                  command: "npx",
                  env: {
                    GITHUB_TOKEN: "${GH_TOKEN_SECRET}",
                    SECOND_TOKEN: "${SECOND_SECRET}",
                    LITERAL: "literal-value",
                  },
                },
              },
            },
          },
        },
      },
    });

    const snapshot = await prepareSecretsRuntimeSnapshot({
      config,
      env: {
        GH_TOKEN_SECRET: "ghp-inline-token",
        SECOND_SECRET: "ghp-second-token",
      },
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    const entries = snapshot.runtimeConfig.plugins?.entries as Record<
      string,
      { config?: Record<string, unknown> }
    >;
    const mcpServers = entries?.acpx?.config?.mcpServers as Record<
      string,
      { env?: Record<string, unknown> }
    >;
    expect(mcpServers?.github?.env?.GITHUB_TOKEN).toBe("ghp-inline-token");
    expect(mcpServers?.github?.env?.SECOND_TOKEN).toBe("ghp-second-token");
    expect(mcpServers?.github?.env?.LITERAL).toBe("literal-value");
  });

  it("treats bundled acpx MCP env refs as inactive until the plugin is enabled", async () => {
    const config = asConfig({
      plugins: {
        entries: {
          acpx: {
            config: {
              mcpServers: {
                github: {
                  command: "npx",
                  env: {
                    GITHUB_TOKEN: {
                      source: "env",
                      provider: "default",
                      id: "GH_TOKEN_SECRET",
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const snapshot = await prepareSecretsRuntimeSnapshot({
      config,
      env: {},
      agentDirs: ["/tmp/crawclaw-agent-main"],
      loadAuthStore: () => ({ version: 1, profiles: {} }),
    });

    expect(
      snapshot.warnings.some(
        (warning) =>
          warning.code === "SECRETS_REF_IGNORED_INACTIVE_SURFACE" &&
          warning.path === "plugins.entries.acpx.config.mcpServers.github.env.GITHUB_TOKEN",
      ),
    ).toBe(true);

    const entries = snapshot.runtimeConfig.plugins?.entries as Record<
      string,
      { config?: Record<string, unknown> }
    >;
    const mcpServers = entries?.acpx?.config?.mcpServers as Record<
      string,
      { env?: Record<string, unknown> }
    >;
    expect(mcpServers?.github?.env?.GITHUB_TOKEN).toEqual({
      source: "env",
      provider: "default",
      id: "GH_TOKEN_SECRET",
    });
  });

  it("does not write inherited auth stores during runtime secret activation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-secrets-runtime-"));
    const stateDir = path.join(root, ".crawclaw");
    const mainAgentDir = path.join(stateDir, "agents", "main", "agent");
    const workerStorePath = path.join(stateDir, "agents", "worker", "agent", "auth-profiles.json");
    const prevStateDir = process.env.CRAWCLAW_STATE_DIR;

    try {
      await fs.mkdir(mainAgentDir, { recursive: true });
      await fs.writeFile(
        path.join(mainAgentDir, "auth-profiles.json"),
        JSON.stringify({
          ...loadAuthStoreWithProfiles({
            "openai:default": {
              type: "api_key",
              provider: "openai",
              keyRef: OPENAI_ENV_KEY_REF,
            },
          }),
        }),
        "utf8",
      );
      process.env.CRAWCLAW_STATE_DIR = stateDir;

      await prepareSecretsRuntimeSnapshot({
        config: {
          agents: {
            list: [{ id: "worker" }],
          },
        },
        env: { OPENAI_API_KEY: "sk-runtime-worker" }, // pragma: allowlist secret
      });

      await expect(fs.access(workerStorePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (prevStateDir === undefined) {
        delete process.env.CRAWCLAW_STATE_DIR;
      } else {
        process.env.CRAWCLAW_STATE_DIR = prevStateDir;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
