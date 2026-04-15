import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import type { PluginWebSearchProviderEntry } from "../plugins/types.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: ((code: number) => {
    throw new Error(`unexpected exit ${code}`);
  }) as RuntimeEnv["exit"],
};

const SEARCH_PROVIDER_ENV_VARS = [
  "BRAVE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "KIMI_API_KEY",
  "MOONSHOT_API_KEY",
  "OPENROUTER_API_KEY",
  "PERPLEXITY_API_KEY",
  "XAI_API_KEY",
] as const;

const mocks = vi.hoisted(() => ({
  resolvePluginWebSearchProviders: vi.fn<
    (params?: { config?: CrawClawConfig }) => PluginWebSearchProviderEntry[]
  >(() => []),
  listBundledWebSearchProviders: vi.fn<() => PluginWebSearchProviderEntry[]>(() => []),
  resolveBundledWebSearchPluginId: vi.fn<(providerId?: string) => string | undefined>(
    () => undefined,
  ),
}));

vi.mock("../plugins/web-search-providers.runtime.js", () => ({
  resolvePluginWebSearchProviders: mocks.resolvePluginWebSearchProviders,
}));

vi.mock("../plugins/bundled-web-search.js", () => ({
  listBundledWebSearchProviders: mocks.listBundledWebSearchProviders,
  resolveBundledWebSearchPluginId: mocks.resolveBundledWebSearchPluginId,
}));

let originalSearchProviderEnv: Partial<Record<(typeof SEARCH_PROVIDER_ENV_VARS)[number], string>> =
  {};

let mod: typeof import("./onboard-search.js");

function providerPluginId(provider: string): string {
  switch (provider) {
    case "gemini":
      return "google";
    case "grok":
      return "xai";
    case "kimi":
      return "moonshot";
    default:
      return provider;
  }
}

function providerEnvVars(provider: string): string[] {
  switch (provider) {
    case "gemini":
      return ["GEMINI_API_KEY", "GOOGLE_API_KEY"];
    case "grok":
      return ["XAI_API_KEY"];
    case "kimi":
      return ["KIMI_API_KEY", "MOONSHOT_API_KEY"];
    case "perplexity":
      return ["PERPLEXITY_API_KEY", "OPENROUTER_API_KEY"];
    case "brave":
      return ["BRAVE_API_KEY"];
    default:
      return [`${provider.toUpperCase()}_API_KEY`];
  }
}

function readSearchCredential(
  searchConfig: Record<string, unknown> | undefined,
  provider: string,
): unknown {
  if (provider === "brave") {
    return (searchConfig as { apiKey?: unknown } | undefined)?.apiKey;
  }
  const scoped =
    searchConfig?.[provider] && typeof searchConfig[provider] === "object"
      ? (searchConfig[provider] as { apiKey?: unknown })
      : undefined;
  return scoped?.apiKey;
}

function writeSearchCredential(
  searchConfigTarget: Record<string, unknown>,
  provider: string,
  value: unknown,
): void {
  if (provider === "brave") {
    (searchConfigTarget as { apiKey?: unknown }).apiKey = value;
    return;
  }
  const scoped = (searchConfigTarget[provider] ??= {}) as { apiKey?: unknown };
  scoped.apiKey = value;
}

function createProviderEntry(
  provider: "brave" | "gemini" | "grok" | "kimi" | "perplexity",
): PluginWebSearchProviderEntry {
  const pluginId = providerPluginId(provider);
  return {
    id: provider,
    pluginId,
    label:
      provider === "gemini"
        ? "Gemini Search"
        : provider === "grok"
          ? "Grok Search"
          : provider === "kimi"
            ? "Kimi Search"
            : provider === "perplexity"
              ? "Perplexity Search"
              : "Brave Search",
    hint: `${provider} provider`,
    onboardingScopes: ["text-inference"],
    envVars: providerEnvVars(provider),
    placeholder: `${provider}-test-key`,
    signupUrl: `https://example.com/${provider}`,
    credentialPath: `plugins.entries.${pluginId}.config.webSearch.apiKey`,
    getCredentialValue: (searchConfig) => readSearchCredential(searchConfig, provider),
    setCredentialValue: (searchConfigTarget, value) =>
      writeSearchCredential(searchConfigTarget, provider, value),
    getConfiguredCredentialValue: (config) =>
      (
        config?.plugins?.entries?.[pluginId]?.config as
          | { webSearch?: { apiKey?: unknown } }
          | undefined
      )?.webSearch?.apiKey,
    setConfiguredCredentialValue: (configTarget, value) => {
      const entries = ((configTarget.plugins ??= {}).entries ??= {}) as Record<string, unknown>;
      const entry = (entries[pluginId] ??= {}) as { config?: Record<string, unknown> };
      const pluginConfig = (entry.config ??= {});
      const webSearch = (pluginConfig.webSearch ??= {}) as { apiKey?: unknown };
      webSearch.apiKey = value;
    },
    applySelectionConfig: (config) => {
      const entries = ((config.plugins ??= {}).entries ??= {}) as Record<string, unknown>;
      const entry = (entries[pluginId] ??= {}) as { enabled?: boolean };
      entry.enabled = true;
      return config;
    },
    createTool: () => null,
  };
}

function providerEntries(): PluginWebSearchProviderEntry[] {
  return [
    createProviderEntry("brave"),
    createProviderEntry("gemini"),
    createProviderEntry("grok"),
    createProviderEntry("kimi"),
    createProviderEntry("perplexity"),
  ];
}

function createPrompter(params: { selectValue?: string; textValue?: string }): {
  prompter: WizardPrompter;
  notes: Array<{ title?: string; message: string }>;
} {
  const notes: Array<{ title?: string; message: string }> = [];
  const prompter: WizardPrompter = {
    intro: vi.fn(async () => {}),
    outro: vi.fn(async () => {}),
    note: vi.fn(async (message: string, title?: string) => {
      notes.push({ title, message });
    }),
    select: vi.fn(
      async () => params.selectValue ?? "perplexity",
    ) as unknown as WizardPrompter["select"],
    multiselect: vi.fn(async () => []) as unknown as WizardPrompter["multiselect"],
    text: vi.fn(async () => params.textValue ?? ""),
    confirm: vi.fn(async () => true),
    progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
  };
  return { prompter, notes };
}

function pluginWebSearchApiKey(config: CrawClawConfig, pluginId: string): unknown {
  const entry = (
    config.plugins?.entries as
      | Record<string, { config?: { webSearch?: { apiKey?: unknown } } }>
      | undefined
  )?.[pluginId];
  return entry?.config?.webSearch?.apiKey;
}

function createDisabledBraveConfig(apiKey?: string): CrawClawConfig {
  return {
    tools: {
      web: {
        search: {
          provider: "brave",
        },
      },
    },
    plugins: {
      entries: {
        brave: {
          enabled: false,
          ...(apiKey
            ? {
                config: {
                  webSearch: {
                    apiKey,
                  },
                },
              }
            : {}),
        },
      },
    },
  };
}

async function runBlankPerplexityKeyEntry(
  apiKey: string,
  enabled?: boolean,
): Promise<CrawClawConfig> {
  const cfg: CrawClawConfig = {
    tools: {
      web: {
        search: {
          provider: "perplexity",
          ...(enabled === undefined ? {} : { enabled }),
        },
      },
    },
    plugins: {
      entries: {
        perplexity: {
          config: {
            webSearch: {
              apiKey,
            },
          },
        },
      },
    },
  };
  const { prompter } = createPrompter({
    selectValue: "perplexity",
    textValue: "",
  });
  return mod.setupSearch(cfg, runtime, prompter);
}

async function runQuickstartPerplexitySetup(
  apiKey: string,
  enabled?: boolean,
): Promise<{ result: CrawClawConfig; prompter: WizardPrompter }> {
  const cfg: CrawClawConfig = {
    tools: {
      web: {
        search: {
          provider: "perplexity",
          ...(enabled === undefined ? {} : { enabled }),
        },
      },
    },
    plugins: {
      entries: {
        perplexity: {
          config: {
            webSearch: {
              apiKey,
            },
          },
        },
      },
    },
  };
  const { prompter } = createPrompter({ selectValue: "perplexity" });
  const result = await mod.setupSearch(cfg, runtime, prompter, {
    quickstartDefaults: true,
  });
  return { result, prompter };
}

describe("setupSearch", () => {
  beforeAll(async () => {
    const entries = providerEntries();
    mocks.listBundledWebSearchProviders.mockReturnValue(entries);
    mocks.resolvePluginWebSearchProviders.mockImplementation((params) =>
      params?.config ? entries : [],
    );
    mocks.resolveBundledWebSearchPluginId.mockImplementation((providerId) =>
      providerId ? providerPluginId(providerId) : undefined,
    );
    mod = await import("./onboard-search.js");
  });

  beforeEach(() => {
    const entries = providerEntries();
    originalSearchProviderEnv = Object.fromEntries(
      SEARCH_PROVIDER_ENV_VARS.map((key) => [key, process.env[key]]),
    );
    for (const key of SEARCH_PROVIDER_ENV_VARS) {
      delete process.env[key];
    }
    mocks.listBundledWebSearchProviders.mockReturnValue(entries);
    mocks.resolvePluginWebSearchProviders.mockImplementation((params) =>
      params?.config ? entries : [],
    );
    mocks.resolveBundledWebSearchPluginId.mockImplementation((providerId) =>
      providerId ? providerPluginId(providerId) : undefined,
    );
  });

  afterEach(() => {
    for (const key of SEARCH_PROVIDER_ENV_VARS) {
      const value = originalSearchProviderEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.clearAllMocks();
  });

  it("returns config unchanged when user skips", async () => {
    const cfg: CrawClawConfig = {};
    const { prompter } = createPrompter({ selectValue: "__skip__" });
    const result = await mod.setupSearch(cfg, runtime, prompter);
    expect(result).toBe(cfg);
  });

  it("sets provider and key for perplexity", async () => {
    const cfg: CrawClawConfig = {};
    const { prompter } = createPrompter({
      selectValue: "perplexity",
      textValue: "pplx-test-key",
    });
    const result = await mod.setupSearch(cfg, runtime, prompter);
    expect(result.tools?.web?.search?.provider).toBe("perplexity");
    expect(pluginWebSearchApiKey(result, "perplexity")).toBe("pplx-test-key");
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(result.plugins?.entries?.perplexity?.enabled).toBe(true);
  });

  it("sets provider and key for brave", async () => {
    const cfg: CrawClawConfig = {};
    const { prompter } = createPrompter({
      selectValue: "brave",
      textValue: "BSA-test-key",
    });
    const result = await mod.setupSearch(cfg, runtime, prompter);
    expect(result.tools?.web?.search?.provider).toBe("brave");
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(pluginWebSearchApiKey(result, "brave")).toBe("BSA-test-key");
    expect(result.plugins?.entries?.brave?.enabled).toBe(true);
  });

  it("sets provider and key for gemini", async () => {
    const cfg: CrawClawConfig = {};
    const { prompter } = createPrompter({
      selectValue: "gemini",
      textValue: "AIza-test",
    });
    const result = await mod.setupSearch(cfg, runtime, prompter);
    expect(result.tools?.web?.search?.provider).toBe("gemini");
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(pluginWebSearchApiKey(result, "google")).toBe("AIza-test");
    expect(result.plugins?.entries?.google?.enabled).toBe(true);
  });

  it("re-enables brave and persists its plugin config when selected from disabled state", async () => {
    const cfg = createDisabledBraveConfig();
    const { prompter } = createPrompter({
      selectValue: "brave",
      textValue: "BSA-disabled-key",
    });
    const result = await mod.setupSearch(cfg, runtime, prompter);
    expect(result.tools?.web?.search?.provider).toBe("brave");
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(result.plugins?.entries?.brave?.enabled).toBe(true);
    expect(pluginWebSearchApiKey(result, "brave")).toBe("BSA-disabled-key");
  });

  it("sets provider and key for grok", async () => {
    const cfg: CrawClawConfig = {};
    const { prompter } = createPrompter({
      selectValue: "grok",
      textValue: "xai-test",
    });
    const result = await mod.setupSearch(cfg, runtime, prompter);
    expect(result.tools?.web?.search?.provider).toBe("grok");
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(pluginWebSearchApiKey(result, "xai")).toBe("xai-test");
    expect(result.plugins?.entries?.xai?.enabled).toBe(true);
  });

  it("sets provider and key for kimi", async () => {
    const cfg: CrawClawConfig = {};
    const { prompter } = createPrompter({
      selectValue: "kimi",
      textValue: "sk-moonshot",
    });
    const result = await mod.setupSearch(cfg, runtime, prompter);
    expect(result.tools?.web?.search?.provider).toBe("kimi");
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(pluginWebSearchApiKey(result, "moonshot")).toBe("sk-moonshot");
    expect(result.plugins?.entries?.moonshot?.enabled).toBe(true);
  });

  it("shows missing-key note when no key is provided and no env var", async () => {
    const original = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;
    try {
      const cfg: CrawClawConfig = {};
      const { prompter, notes } = createPrompter({
        selectValue: "brave",
        textValue: "",
      });
      const result = await mod.setupSearch(cfg, runtime, prompter);
      expect(result.tools?.web?.search?.provider).toBe("brave");
      expect(result.tools?.web?.search?.enabled).toBeUndefined();
      const missingNote = notes.find((n) => n.message.includes("No Brave Search API key stored"));
      expect(missingNote).toBeDefined();
    } finally {
      if (original === undefined) {
        delete process.env.BRAVE_API_KEY;
      } else {
        process.env.BRAVE_API_KEY = original;
      }
    }
  });

  it("keeps existing key when user leaves input blank", async () => {
    const result = await runBlankPerplexityKeyEntry("existing-key");
    expect(pluginWebSearchApiKey(result, "perplexity")).toBe("existing-key");
    expect(result.tools?.web?.search?.enabled).toBe(true);
  });

  it("quickstart skips key prompt when config key exists", async () => {
    const { result, prompter } = await runQuickstartPerplexitySetup("stored-pplx-key");
    expect(result.tools?.web?.search?.provider).toBe("perplexity");
    expect(pluginWebSearchApiKey(result, "perplexity")).toBe("stored-pplx-key");
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(prompter.text).not.toHaveBeenCalled();
  });

  it("quickstart falls through to key prompt when no key and no env var", async () => {
    const original = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    try {
      const cfg: CrawClawConfig = {};
      const { prompter } = createPrompter({ selectValue: "grok", textValue: "" });
      const result = await mod.setupSearch(cfg, runtime, prompter, {
        quickstartDefaults: true,
      });
      expect(prompter.text).toHaveBeenCalled();
      expect(result.tools?.web?.search?.provider).toBe("grok");
      expect(result.tools?.web?.search?.enabled).toBeUndefined();
    } finally {
      if (original === undefined) {
        delete process.env.XAI_API_KEY;
      } else {
        process.env.XAI_API_KEY = original;
      }
    }
  });

  it("uses provider-specific credential copy for kimi in onboarding", async () => {
    const cfg: CrawClawConfig = {};
    const { prompter } = createPrompter({
      selectValue: "kimi",
      textValue: "",
    });
    await mod.setupSearch(cfg, runtime, prompter);
    expect(prompter.text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Kimi Search API key",
      }),
    );
  });

  it("quickstart skips key prompt when env var is available", async () => {
    const orig = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = "env-brave-key";
    try {
      const cfg: CrawClawConfig = {};
      const { prompter } = createPrompter({ selectValue: "brave" });
      const result = await mod.setupSearch(cfg, runtime, prompter, {
        quickstartDefaults: true,
      });
      expect(result.tools?.web?.search?.provider).toBe("brave");
      expect(result.tools?.web?.search?.enabled).toBe(true);
      expect(prompter.text).not.toHaveBeenCalled();
    } finally {
      if (orig === undefined) {
        delete process.env.BRAVE_API_KEY;
      } else {
        process.env.BRAVE_API_KEY = orig;
      }
    }
  });

  it("quickstart detects an existing brave key even when the plugin is disabled", async () => {
    const cfg = createDisabledBraveConfig("BSA-configured-key");
    const { prompter } = createPrompter({ selectValue: "brave" });
    const result = await mod.setupSearch(cfg, runtime, prompter, {
      quickstartDefaults: true,
    });
    expect(prompter.text).not.toHaveBeenCalled();
    expect(result.tools?.web?.search?.provider).toBe("brave");
    expect(result.tools?.web?.search?.enabled).toBe(true);
    expect(result.plugins?.entries?.brave?.enabled).toBe(true);
    expect(pluginWebSearchApiKey(result, "brave")).toBe("BSA-configured-key");
  });

  it("stores env-backed SecretRef when secretInputMode=ref for perplexity", async () => {
    const originalPerplexity = process.env.PERPLEXITY_API_KEY;
    const originalOpenRouter = process.env.OPENROUTER_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const cfg: CrawClawConfig = {};
    try {
      const { prompter } = createPrompter({ selectValue: "perplexity" });
      const result = await mod.setupSearch(cfg, runtime, prompter, {
        secretInputMode: "ref",
      });
      expect(result.tools?.web?.search?.provider).toBe("perplexity");
      expect(pluginWebSearchApiKey(result, "perplexity")).toEqual({
        source: "env",
        provider: "default",
        id: "PERPLEXITY_API_KEY",
      });
      expect(prompter.text).not.toHaveBeenCalled();
    } finally {
      if (originalPerplexity === undefined) {
        delete process.env.PERPLEXITY_API_KEY;
      } else {
        process.env.PERPLEXITY_API_KEY = originalPerplexity;
      }
      if (originalOpenRouter === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalOpenRouter;
      }
    }
  });

  it("prefers detected OPENROUTER_API_KEY SecretRef for perplexity ref mode", async () => {
    const originalPerplexity = process.env.PERPLEXITY_API_KEY;
    const originalOpenRouter = process.env.OPENROUTER_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const cfg: CrawClawConfig = {};
    try {
      const { prompter } = createPrompter({ selectValue: "perplexity" });
      const result = await mod.setupSearch(cfg, runtime, prompter, {
        secretInputMode: "ref",
      });
      expect(pluginWebSearchApiKey(result, "perplexity")).toEqual({
        source: "env",
        provider: "default",
        id: "OPENROUTER_API_KEY",
      });
      expect(prompter.text).not.toHaveBeenCalled();
    } finally {
      if (originalPerplexity === undefined) {
        delete process.env.PERPLEXITY_API_KEY;
      } else {
        process.env.PERPLEXITY_API_KEY = originalPerplexity;
      }
      if (originalOpenRouter === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalOpenRouter;
      }
    }
  });

  it("stores env-backed SecretRef when secretInputMode=ref for brave", async () => {
    const cfg: CrawClawConfig = {};
    const { prompter } = createPrompter({ selectValue: "brave" });
    const result = await mod.setupSearch(cfg, runtime, prompter, {
      secretInputMode: "ref",
    });
    expect(result.tools?.web?.search?.provider).toBe("brave");
    expect(pluginWebSearchApiKey(result, "brave")).toEqual({
      source: "env",
      provider: "default",
      id: "BRAVE_API_KEY",
    });
    expect(result.plugins?.entries?.brave?.enabled).toBe(true);
    expect(prompter.text).not.toHaveBeenCalled();
  });

  it("stores plaintext key when secretInputMode is unset", async () => {
    const cfg: CrawClawConfig = {};
    const { prompter } = createPrompter({
      selectValue: "brave",
      textValue: "BSA-plain",
    });
    const result = await mod.setupSearch(cfg, runtime, prompter);
    expect(pluginWebSearchApiKey(result, "brave")).toBe("BSA-plain");
  });

  it("exports all 5 providers in alphabetical order", () => {
    const values = mod.SEARCH_PROVIDER_OPTIONS.map((e) => e.id);
    expect(mod.SEARCH_PROVIDER_OPTIONS).toHaveLength(5);
    expect(values).toEqual(["brave", "gemini", "grok", "kimi", "perplexity"]);
  });
});
