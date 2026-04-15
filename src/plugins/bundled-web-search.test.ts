import { beforeAll, describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { BUNDLED_WEB_SEARCH_PLUGIN_IDS } from "./bundled-web-search-ids.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
import { isApiKeylessBundledWebSearchPluginId } from "./web-search-provider-policy.js";

let hasBundledWebSearchCredential: typeof import("./bundled-web-search-registry.js").hasBundledWebSearchCredential;
let listBundledWebSearchProviders: typeof import("./bundled-web-search.js").listBundledWebSearchProviders;
let resolveBundledWebSearchPluginIds: typeof import("./bundled-web-search.js").resolveBundledWebSearchPluginIds;

function resolveManifestBundledWebSearchPluginIds() {
  return loadPluginManifestRegistry({})
    .plugins.filter(
      (plugin) =>
        plugin.origin === "bundled" &&
        isApiKeylessBundledWebSearchPluginId(plugin.id) &&
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

  it("keeps bundled web search fast-path ids aligned with the registry", async () => {
    expectBundledWebSearchAlignment({
      actual: [...BUNDLED_WEB_SEARCH_PLUGIN_IDS],
      expected: await resolveRegistryBundledWebSearchPluginIds(),
    });
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
      name: "detects open-websearch plugin base URL config",
      config: {
        ...baseCfg,
        plugins: {
          entries: {
            "open-websearch": {
              enabled: true,
              config: { webSearch: { baseUrl: "http://127.0.0.1:3210" } },
            },
          },
        },
      } satisfies CrawClawConfig,
      env: {},
    },
    {
      name: "detects open-websearch env base URL",
      config: baseCfg,
      env: { OPEN_WEBSEARCH_BASE_URL: "http://127.0.0.1:3210" },
    },
  ] as const)("$name", async ({ config, env }) => {
    expect(hasBundledWebSearchCredential({ config, env })).toBe(true);
  });
});
