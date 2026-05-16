import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebFetchProviderPlugin, WebSearchProviderPlugin } from "../types.js";

type MockPluginRecord = {
  id: string;
  status: "loaded" | "error";
  error?: string;
  providerIds: string[];
  webFetchProviderIds: string[];
  webSearchProviderIds: string[];
};

type MockRuntimeRegistry = {
  plugins: MockPluginRecord[];
  diagnostics: Array<{ pluginId?: string; message: string }>;
  webFetchProviders: Array<{ pluginId: string; provider: WebFetchProviderPlugin }>;
  webSearchProviders: Array<{ pluginId: string; provider: WebSearchProviderPlugin }>;
};

function createMockRuntimeRegistry(params: {
  plugin: MockPluginRecord;
  webFetchProviders?: Array<{ pluginId: string; provider: WebFetchProviderPlugin }>;
  webSearchProviders?: Array<{ pluginId: string; provider: WebSearchProviderPlugin }>;
  diagnostics?: Array<{ pluginId?: string; message: string }>;
}): MockRuntimeRegistry {
  return {
    plugins: [params.plugin],
    diagnostics: params.diagnostics ?? [],
    webFetchProviders: params.webFetchProviders ?? [],
    webSearchProviders: params.webSearchProviders ?? [],
  };
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("plugin contract registry scoped retries", () => {
  it("retries web search provider loads after a transient plugin-scoped runtime error", async () => {
    const loadBundledCapabilityRuntimeRegistry = vi
      .fn()
      .mockReturnValueOnce(
        createMockRuntimeRegistry({
          plugin: {
            id: "xai",
            status: "error",
            error: "transient grok load failure",
            providerIds: [],
            webFetchProviderIds: [],
            webSearchProviderIds: [],
          },
          diagnostics: [{ pluginId: "xai", message: "transient grok load failure" }],
        }),
      )
      .mockReturnValueOnce(
        createMockRuntimeRegistry({
          plugin: {
            id: "xai",
            status: "loaded",
            providerIds: ["xai"],
            webFetchProviderIds: [],
            webSearchProviderIds: ["grok"],
          },
          webSearchProviders: [
            {
              pluginId: "xai",
              provider: {
                id: "grok",
                label: "Grok Search",
                hint: "Search the web with Grok",
                envVars: ["XAI_API_KEY"],
                placeholder: "XAI_API_KEY",
                signupUrl: "https://x.ai",
                credentialPath: "plugins.entries.xai.config.webSearch.apiKey",
                requiresCredential: true,
                getCredentialValue: () => undefined,
                setCredentialValue() {},
                createTool: () => ({
                  description: "search",
                  parameters: {},
                  execute: async () => ({}),
                }),
              } as WebSearchProviderPlugin,
            },
          ],
        }),
      );

    vi.doMock("../bundled-capability-runtime.js", () => ({
      loadBundledCapabilityRuntimeRegistry,
    }));

    const { resolveWebSearchProviderContractEntriesForPluginId } = await import("./registry.js");

    expect(
      resolveWebSearchProviderContractEntriesForPluginId("xai").map((entry) => entry.provider.id),
    ).toEqual(["grok"]);
    expect(loadBundledCapabilityRuntimeRegistry).toHaveBeenCalledTimes(2);
  });

  it("retries web fetch provider loads after a transient plugin-scoped runtime error", async () => {
    const loadBundledCapabilityRuntimeRegistry = vi
      .fn()
      .mockReturnValueOnce(
        createMockRuntimeRegistry({
          plugin: {
            id: "spider-fetch",
            status: "error",
            error: "transient spider fetch load failure",
            providerIds: [],
            webFetchProviderIds: [],
            webSearchProviderIds: [],
          },
          diagnostics: [
            { pluginId: "spider-fetch", message: "transient spider fetch load failure" },
          ],
        }),
      )
      .mockReturnValueOnce(
        createMockRuntimeRegistry({
          plugin: {
            id: "spider-fetch",
            status: "loaded",
            providerIds: [],
            webFetchProviderIds: ["spider"],
            webSearchProviderIds: [],
          },
          webFetchProviders: [
            {
              pluginId: "spider-fetch",
              provider: {
                id: "spider",
                label: "Spider",
                hint: "Fetch with Spider",
                envVars: [],
                placeholder: "managed-local-sidecar",
                signupUrl: "https://github.com/D4Vinci/Spider",
                credentialPath: "plugins.entries.spider-fetch.config.webFetch.apiKey",
                requiresCredential: false,
                getCredentialValue: () => undefined,
                setCredentialValue() {},
                createTool: () => ({
                  description: "fetch",
                  parameters: {},
                  execute: async () => ({}),
                }),
              } as WebFetchProviderPlugin,
            },
          ],
        }),
      );

    vi.doMock("../bundled-capability-runtime.js", () => ({
      loadBundledCapabilityRuntimeRegistry,
    }));

    const { resolveWebFetchProviderContractEntriesForPluginId } = await import("./registry.js");

    expect(
      resolveWebFetchProviderContractEntriesForPluginId("spider-fetch").map(
        (entry) => entry.provider.id,
      ),
    ).toEqual(["spider"]);
    expect(loadBundledCapabilityRuntimeRegistry).toHaveBeenCalledTimes(2);
  });
});
