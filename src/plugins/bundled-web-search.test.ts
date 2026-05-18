import { beforeAll, describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { BUNDLED_WEB_SEARCH_PLUGIN_IDS } from "./bundled-capability-metadata.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";

let hasBundledWebSearchCredential: typeof import("./bundled-web-search-registry.js").hasBundledWebSearchCredential;
let listBundledWebSearchProviders: typeof import("./bundled-web-search.js").listBundledWebSearchProviders;
let resolveBundledWebSearchPluginIds: typeof import("./bundled-web-search.js").resolveBundledWebSearchPluginIds;

function resolveManifestBundledWebSearchPluginIds() {
  const bundledWebSearchPluginIds = new Set(BUNDLED_WEB_SEARCH_PLUGIN_IDS);
  return loadPluginManifestRegistry({})
    .plugins.filter(
      (plugin) =>
        plugin.origin === "bundled" &&
        bundledWebSearchPluginIds.has(plugin.id) &&
        (plugin.contracts?.webSearchProviders?.length ?? 0) > 0,
    )
    .map((plugin) => plugin.id)
    .toSorted((left, right) => left.localeCompare(right));
}

async function resolveRegistryBundledWebSearchPluginIds() {
  return listBundledWebSearchProviders()
    .map(({ pluginId }) => pluginId)
    .filter((value, index, values) => values.indexOf(value) === index)
    .toSorted((left, right) => left.localeCompare(right));
}

beforeAll(async () => {
  ({ listBundledWebSearchProviders, resolveBundledWebSearchPluginIds } =
    await import("./bundled-web-search.js"));
  ({ hasBundledWebSearchCredential } = await import("./bundled-web-search-registry.js"));
});

function expectBundledWebSearchIds(actual: readonly string[], expected: readonly string[]) {
  expect(actual).toEqual(expected);
}

function expectBundledWebSearchAlignment(params: {
  actual: readonly string[];
  expected: readonly string[];
}) {
  expectBundledWebSearchIds(params.actual, params.expected);
}

describe("bundled web search metadata", () => {
  it("keeps bundled web search compat ids aligned with bundled manifests", async () => {
    expectBundledWebSearchAlignment({
      actual: resolveBundledWebSearchPluginIds({}),
      expected: resolveManifestBundledWebSearchPluginIds(),
    });
  });

  it("uses Rust-generated native descriptors for bundled web search provider objects", async () => {
    expectBundledWebSearchAlignment({
      actual: await resolveRegistryBundledWebSearchPluginIds(),
      expected: resolveManifestBundledWebSearchPluginIds(),
    });
    expect([...BUNDLED_WEB_SEARCH_PLUGIN_IDS]).toEqual(resolveManifestBundledWebSearchPluginIds());
  });
});

describe("hasBundledWebSearchCredential", () => {
  const baseCfg = {
    agents: { defaults: { model: { primary: "ollama/mistral-8b" } } },
    browser: { enabled: false },
    tools: { web: { fetch: { enabled: false } } },
  } satisfies CrawClawConfig;

  it.each([
    {
      name: "detects searxng plugin base URL config",
      config: {
        ...baseCfg,
        plugins: {
          entries: {
            searxng: {
              enabled: true,
              config: { webSearch: { baseUrl: "http://127.0.0.1:3210" } },
            },
          },
        },
      } satisfies CrawClawConfig,
      env: {},
    },
    {
      name: "detects searxng env base URL",
      config: baseCfg,
      env: { SEARXNG_BASE_URL: "http://127.0.0.1:3210" },
    },
  ] as const)("$name", async ({ config, env }) => {
    expect(hasBundledWebSearchCredential({ config, env })).toBe(true);
  });
});
