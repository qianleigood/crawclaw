import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyPluginRegistry } from "./registry.js";

type LoaderModule = typeof import("./loader.js");
type ManifestRegistryModule = typeof import("./manifest-registry.js");
type RuntimeModule = typeof import("./runtime.js");
type WebFetchProvidersRuntimeModule = typeof import("./web-fetch-providers.runtime.js");
type WebFetchProvidersSharedModule = typeof import("./web-fetch-providers.shared.js");

let loaderModule: LoaderModule;
let manifestRegistryModule: ManifestRegistryModule;
let webFetchProvidersSharedModule: WebFetchProvidersSharedModule;
let loadCrawClawPluginsMock: ReturnType<typeof vi.fn>;
let setActivePluginRegistry: RuntimeModule["setActivePluginRegistry"];
let resolvePluginWebFetchProviders: WebFetchProvidersRuntimeModule["resolvePluginWebFetchProviders"];
let resetWebFetchProviderSnapshotCacheForTests: WebFetchProvidersRuntimeModule["__testing"]["resetWebFetchProviderSnapshotCacheForTests"];

const DEFAULT_WORKSPACE = "/tmp/workspace";

function createWebFetchEnv(overrides?: Partial<NodeJS.ProcessEnv>) {
  return {
    CRAWCLAW_HOME: "/tmp/crawclaw-home",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function createSampleFetchAllowConfig() {
  return {
    plugins: {
      allow: ["sample-fetch"],
    },
  };
}

function createManifestRegistryFixture() {
  return {
    plugins: [
      {
        id: "sample-fetch",
        origin: "bundled",
        rootDir: "/tmp/sample-fetch",
        source: "/tmp/sample-fetch/index.js",
        manifestPath: "/tmp/sample-fetch/crawclaw.plugin.json",
        channels: [],
        providers: [],
        skills: [],
        hooks: [],
        configUiHints: { "webFetch.apiKey": { label: "key" } },
      },
      {
        id: "noise",
        origin: "bundled",
        rootDir: "/tmp/noise",
        source: "/tmp/noise/index.js",
        manifestPath: "/tmp/noise/crawclaw.plugin.json",
        channels: [],
        providers: [],
        skills: [],
        hooks: [],
        configUiHints: { unrelated: { label: "nope" } },
      },
    ],
    diagnostics: [],
  };
}

function createRuntimeWebFetchProvider() {
  return {
    pluginId: "sample-fetch",
    pluginName: "Sample Fetch",
    source: "test" as const,
    provider: {
      id: "sample-fetch",
      label: "Sample Fetch",
      hint: "sample web fetch runtime provider",
      envVars: ["SAMPLE_FETCH_API_KEY"],
      placeholder: "sample-fetch-...",
      signupUrl: "https://example.com/sample-fetch",
      credentialPath: "plugins.entries.sample-fetch.config.webFetch.apiKey",
      getCredentialValue: () => "configured",
      setCredentialValue: () => {},
      createTool: () => ({
        description: "sample-fetch",
        parameters: {},
        execute: async () => ({}),
      }),
    },
  };
}

describe("resolvePluginWebFetchProviders", () => {
  beforeAll(async () => {
    loaderModule = await import("./loader.js");
    manifestRegistryModule = await import("./manifest-registry.js");
    webFetchProvidersSharedModule = await import("./web-fetch-providers.shared.js");
    ({ setActivePluginRegistry } = await import("./runtime.js"));
    ({
      resolvePluginWebFetchProviders,
      __testing: { resetWebFetchProviderSnapshotCacheForTests },
    } = await import("./web-fetch-providers.runtime.js"));
  });

  beforeEach(() => {
    resetWebFetchProviderSnapshotCacheForTests();
    vi.spyOn(manifestRegistryModule, "loadPluginManifestRegistry").mockReturnValue(
      createManifestRegistryFixture() as ManifestRegistryModule["loadPluginManifestRegistry"] extends (
        ...args: unknown[]
      ) => infer R
        ? R
        : never,
    );
    loadCrawClawPluginsMock = vi
      .spyOn(loaderModule, "loadCrawClawPlugins")
      .mockImplementation(() => {
        const registry = createEmptyPluginRegistry();
        registry.webFetchProviders = [createRuntimeWebFetchProvider()];
        return registry;
      });
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  afterEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
    vi.restoreAllMocks();
  });

  it("falls back to the plugin loader when no compatible active registry exists", () => {
    const providers = resolvePluginWebFetchProviders({});

    expect(providers.map((provider) => `${provider.pluginId}:${provider.id}`)).toEqual([
      "sample-fetch:sample-fetch",
    ]);
    expect(loadCrawClawPluginsMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a compatible active registry for snapshot resolution when config is provided", () => {
    const env = createWebFetchEnv();
    const rawConfig = createSampleFetchAllowConfig();
    const { config, activationSourceConfig, autoEnabledReasons } =
      webFetchProvidersSharedModule.resolveBundledWebFetchResolutionConfig({
        config: rawConfig,
        bundledAllowlistCompat: true,
        env,
      });
    const { cacheKey } = loaderModule.__testing.resolvePluginLoadCacheContext({
      config,
      activationSourceConfig,
      autoEnabledReasons,
      workspaceDir: DEFAULT_WORKSPACE,
      env,
      onlyPluginIds: ["sample-fetch"],
      cache: false,
      activate: false,
    });
    const registry = createEmptyPluginRegistry();
    registry.webFetchProviders.push(createRuntimeWebFetchProvider());
    setActivePluginRegistry(registry, cacheKey);

    const providers = resolvePluginWebFetchProviders({
      config: rawConfig,
      bundledAllowlistCompat: true,
      workspaceDir: DEFAULT_WORKSPACE,
      env,
    });

    expect(providers.map((provider) => `${provider.pluginId}:${provider.id}`)).toEqual([
      "sample-fetch:sample-fetch",
    ]);
    expect(loadCrawClawPluginsMock).not.toHaveBeenCalled();
  });
});
