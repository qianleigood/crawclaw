import { describe, expect, it } from "vitest";
import { resolveBundledPluginWebSearchProviders } from "./web-search-providers.js";

const WEB_SEARCH_PROVIDER_TEST_TIMEOUT_MS = 300_000;
const EXPECTED_BUNDLED_WEB_SEARCH_PROVIDER_KEYS = ["open-websearch:open-websearch"] as const;
const EXPECTED_BUNDLED_WEB_SEARCH_PROVIDER_PLUGIN_IDS = ["open-websearch"] as const;
const EXPECTED_BUNDLED_WEB_SEARCH_CREDENTIAL_PATHS = [
  "plugins.entries.open-websearch.config.webSearch.baseUrl",
] as const;

function toProviderKeys(
  providers: ReturnType<typeof resolveBundledPluginWebSearchProviders>,
): string[] {
  return providers.map((provider) => `${provider.pluginId}:${provider.id}`);
}

function expectBundledWebSearchProviders(
  providers: ReturnType<typeof resolveBundledPluginWebSearchProviders>,
) {
  expect(toProviderKeys(providers)).toEqual(EXPECTED_BUNDLED_WEB_SEARCH_PROVIDER_KEYS);
  expect(providers.map((provider) => provider.credentialPath)).toEqual(
    EXPECTED_BUNDLED_WEB_SEARCH_CREDENTIAL_PATHS,
  );
}

function expectResolvedPluginIds(
  providers: ReturnType<typeof resolveBundledPluginWebSearchProviders>,
  expectedPluginIds: readonly string[],
) {
  expect(providers.map((provider) => provider.pluginId)).toEqual(expectedPluginIds);
}

function expectResolvedPluginIdsExcluding(
  providers: ReturnType<typeof resolveBundledPluginWebSearchProviders>,
  unexpectedPluginIds: readonly string[],
) {
  const pluginIds = providers.map((provider) => provider.pluginId);
  for (const pluginId of unexpectedPluginIds) {
    expect(pluginIds).not.toContain(pluginId);
  }
}

function expectBundledWebSearchResolution(params: {
  options?: Parameters<typeof resolveBundledPluginWebSearchProviders>[0];
  expectedProviders?: "full";
  expectedPluginIds?: readonly string[];
  excludedPluginIds?: readonly string[];
}) {
  const providers = resolveBundledPluginWebSearchProviders(params.options ?? {});

  if (params.expectedProviders === "full") {
    expectBundledWebSearchProviders(providers);
  }
  if (params.expectedPluginIds) {
    expectResolvedPluginIds(providers, params.expectedPluginIds);
  }
  if (params.excludedPluginIds) {
    expectResolvedPluginIdsExcluding(providers, params.excludedPluginIds);
  }
}

describe("resolveBundledPluginWebSearchProviders", () => {
  it.each([
    {
      title: "returns bundled providers in alphabetical order",
      options: {},
    },
    {
      title: "can resolve bundled providers through the manifest-scoped loader path",
      options: {
        bundledAllowlistCompat: true,
      },
    },
  ] as const)("$title", { timeout: WEB_SEARCH_PROVIDER_TEST_TIMEOUT_MS }, ({ options }) => {
    const providers = resolveBundledPluginWebSearchProviders(options);

    expectBundledWebSearchProviders(providers);
    expect(providers.every((provider) => !provider.credentialPath.endsWith(".apiKey"))).toBe(true);
  });

  it.each([
    {
      title: "can augment restrictive allowlists for bundled compatibility",
      params: {
        config: {
          plugins: {
            allow: ["demo-other-plugin"],
          },
        },
        bundledAllowlistCompat: true,
      },
      expectedPluginIds: EXPECTED_BUNDLED_WEB_SEARCH_PROVIDER_PLUGIN_IDS,
    },
    {
      title: "does not return bundled providers excluded by a restrictive allowlist without compat",
      params: {
        config: {
          plugins: {
            allow: ["demo-other-plugin"],
          },
        },
      },
      expectedPluginIds: [],
    },
    {
      title: "returns no providers when plugins are globally disabled",
      params: {
        config: {
          plugins: {
            enabled: false,
          },
        },
      },
      expectedPluginIds: [],
    },
    {
      title: "can scope bundled resolution to one plugin id",
      params: {
        config: {
          tools: {
            web: {
              search: {
                provider: "open-websearch",
              },
            },
          },
        },
        bundledAllowlistCompat: true,
        onlyPluginIds: ["open-websearch"],
      },
      expectedPluginIds: ["open-websearch"],
    },
    {
      title: "preserves explicit bundled provider entry state",
      params: {
        config: {
          plugins: {
            entries: {
              "open-websearch": { enabled: false },
            },
          },
        },
      },
      excludedPluginIds: ["open-websearch"],
    },
  ])("$title", ({ params, expectedPluginIds, excludedPluginIds }) => {
    expectBundledWebSearchResolution({
      options: params,
      expectedPluginIds,
      excludedPluginIds,
    });
  });
});
