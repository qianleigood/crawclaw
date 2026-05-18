import { describe, expect, it } from "vitest";
import { resolveBundledWebFetchPluginIds } from "../bundled-web-fetch.js";
import { resolveBundledWebSearchPluginIds } from "../bundled-web-search.js";
import { pluginRegistrationContractRegistry } from "./registry.js";
import { uniqueSortedStrings } from "./testkit.js";

describe("plugin contract registry", () => {
  function expectUniqueIds(ids: readonly string[]) {
    expect(ids).toEqual([...new Set(ids)]);
  }

  it("loads bundled non-provider capability registries without import-time failure", () => {
    expect(pluginRegistrationContractRegistry.length).toBeGreaterThan(0);
  });

  it.each([
    {
      name: "does not duplicate bundled provider ids",
      ids: () => pluginRegistrationContractRegistry.flatMap((entry) => entry.providerIds),
    },
    {
      name: "does not duplicate bundled web fetch provider ids",
      ids: () => pluginRegistrationContractRegistry.flatMap((entry) => entry.webFetchProviderIds),
    },
    {
      name: "does not duplicate bundled web search provider ids",
      ids: () => pluginRegistrationContractRegistry.flatMap((entry) => entry.webSearchProviderIds),
    },
  ] as const)("$name", ({ ids }) => {
    expectUniqueIds(ids());
  });

  it("covers every bundled web fetch plugin from the shared resolver", () => {
    const bundledWebFetchPluginIds = resolveBundledWebFetchPluginIds({});

    expect(
      uniqueSortedStrings(
        pluginRegistrationContractRegistry
          .filter((entry) => entry.webFetchProviderIds.length > 0)
          .map((entry) => entry.pluginId),
      ),
    ).toEqual(bundledWebFetchPluginIds);
  });

  it("covers every bundled web search plugin from the shared resolver", () => {
    const bundledWebSearchPluginIds = resolveBundledWebSearchPluginIds({});

    expect(
      uniqueSortedStrings(
        pluginRegistrationContractRegistry
          .filter((entry) => entry.webSearchProviderIds.length > 0)
          .map((entry) => entry.pluginId),
      ),
    ).toEqual(bundledWebSearchPluginIds);
  });
});
