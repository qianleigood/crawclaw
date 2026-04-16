import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPEN_WEBSEARCH_ENGINES,
  resolveOpenWebSearchBaseUrl,
  resolveOpenWebSearchAutoStart,
  resolveOpenWebSearchDefaultEngines,
  resolveOpenWebSearchHost,
  resolveOpenWebSearchPort,
  resolveOpenWebSearchStartupTimeoutMs,
} from "./config.js";

const { runOpenWebSearch } = vi.hoisted(() => ({
  runOpenWebSearch: vi.fn(async (params: Record<string, unknown>) => params),
}));

vi.mock("../../../src/open-websearch/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/open-websearch/client.js")>();
  return {
    ...actual,
    runOpenWebSearch,
  };
});

describe("open-websearch web search provider", () => {
  let createOpenWebSearchProvider: typeof import("./open-websearch-provider.js").createOpenWebSearchProvider;
  let plugin: typeof import("../index.js").default;

  beforeAll(async () => {
    ({ createOpenWebSearchProvider } = await import("./open-websearch-provider.js"));
    ({ default: plugin } = await import("../index.js"));
  });

  beforeEach(() => {
    runOpenWebSearch.mockReset();
    runOpenWebSearch.mockImplementation(async (params: Record<string, unknown>) => params);
  });

  it("registers a setup-visible web search provider", () => {
    const webSearchProviders: unknown[] = [];

    plugin.register({
      registerService() {},
      registerWebSearchProvider(provider: unknown) {
        webSearchProviders.push(provider);
      },
    } as never);

    expect(plugin.id).toBe("open-websearch");
    expect(webSearchProviders).toHaveLength(1);

    const provider = webSearchProviders[0] as Record<string, unknown>;
    expect(provider.id).toBe("open-websearch");
    expect(provider.requiresCredential).toBe(false);
    expect(provider.envVars).toEqual(["OPEN_WEBSEARCH_BASE_URL"]);
  });

  it("exposes credential metadata and enables the plugin in config", () => {
    const provider = createOpenWebSearchProvider();
    const applied = provider.applySelectionConfig?.({});

    expect(provider.id).toBe("open-websearch");
    expect(provider.credentialPath).toBe("plugins.entries.open-websearch.config.webSearch.baseUrl");
    expect(applied?.plugins?.entries?.["open-websearch"]?.enabled).toBe(true);
  });

  it("maps generic tool arguments into open-websearch params", async () => {
    const provider = createOpenWebSearchProvider();
    const tool = provider.createTool({ config: { test: true } } as never);

    const result = await tool?.execute({
      query: "crawclaw docs",
      count: 4,
    });

    expect(runOpenWebSearch).toHaveBeenCalledWith({
      config: { test: true },
      query: "crawclaw docs",
      count: 4,
    });
    expect(result).toEqual({
      config: { test: true },
      query: "crawclaw docs",
      count: 4,
    });
  });

  it("reads base URL from plugin config SecretRef and engines from config or env", () => {
    expect(
      resolveOpenWebSearchBaseUrl(
        {
          plugins: {
            entries: {
              "open-websearch": {
                config: {
                  webSearch: {
                    baseUrl: {
                      source: "env",
                      provider: "default",
                      id: "OPEN_WEBSEARCH_BASE_URL",
                    },
                  },
                },
              },
            },
          },
        } as never,
        { OPEN_WEBSEARCH_BASE_URL: "http://127.0.0.1:3000/" },
      ),
    ).toBe("http://127.0.0.1:3000");

    expect(
      resolveOpenWebSearchDefaultEngines({
        plugins: {
          entries: {
            "open-websearch": {
              config: {
                webSearch: {
                  engines: ["duckduckgo", "bing", "duckduckgo"],
                },
              },
            },
          },
        },
      } as never),
    ).toEqual(["duckduckgo", "bing"]);

    expect(
      resolveOpenWebSearchDefaultEngines({} as never, { OPEN_WEBSEARCH_ENGINES: "brave, exa" }),
    ).toEqual(["brave", "exa"]);
    expect(resolveOpenWebSearchDefaultEngines({} as never, {})).toEqual([
      ...DEFAULT_OPEN_WEBSEARCH_ENGINES,
    ]);
    expect(resolveOpenWebSearchBaseUrl({} as never, {})).toBe("http://127.0.0.1:3210");
    expect(resolveOpenWebSearchAutoStart({} as never, {})).toBe(true);
    expect(resolveOpenWebSearchHost({} as never, {})).toBe("127.0.0.1");
    expect(resolveOpenWebSearchPort({} as never, {})).toBe(3210);
    expect(resolveOpenWebSearchStartupTimeoutMs({} as never, {})).toBe(20_000);
  });
});
