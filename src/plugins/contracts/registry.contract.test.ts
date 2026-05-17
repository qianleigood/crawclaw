import { describe, expect, it } from "vitest";
import { resolveBundledWebFetchPluginIds } from "../bundled-web-fetch.js";
import { resolveBundledWebSearchPluginIds } from "../bundled-web-search.js";
import { loadPluginManifestRegistry } from "../manifest-registry.js";
import {
  pluginRegistrationContractRegistry,
  providerContractLoadError,
  speechProviderContractRegistry,
  webFetchProviderContractRegistry,
  webSearchProviderContractRegistry,
} from "./registry.js";
import { uniqueSortedStrings } from "./testkit.js";

const REGISTRY_CONTRACT_TIMEOUT_MS = 300_000;

describe("plugin contract registry", () => {
  function expectUniqueIds(ids: readonly string[]) {
    expect(ids).toEqual([...new Set(ids)]);
  }

  function expectRegistryPluginIds(params: {
    actualPluginIds: readonly string[];
    predicate: (plugin: {
      origin: string;
      providers: unknown[];
      contracts?: { speechProviders?: unknown[] };
    }) => boolean;
  }) {
    expect(uniqueSortedStrings(params.actualPluginIds)).toEqual(
      resolveBundledManifestPluginIds(params.predicate),
    );
  }

  function resolveBundledManifestPluginIds(
    predicate: (plugin: {
      origin: string;
      providers: unknown[];
      contracts?: { speechProviders?: unknown[] };
    }) => boolean,
  ) {
    return loadPluginManifestRegistry({})
      .plugins.filter(predicate)
      .map((plugin) => plugin.id)
      .toSorted((left, right) => left.localeCompare(right));
  }

  it("loads bundled non-provider capability registries without import-time failure", () => {
    expect(providerContractLoadError).toBeUndefined();
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

  it(
    "does not duplicate bundled speech provider ids",
    { timeout: REGISTRY_CONTRACT_TIMEOUT_MS },
    () => {
      expectUniqueIds(speechProviderContractRegistry.map((entry) => entry.provider.id));
    },
  );

  it("keeps native speech provider implementations out of the TypeScript registry", () => {
    expect(speechProviderContractRegistry).toEqual([]);
    expectRegistryPluginIds({
      actualPluginIds: pluginRegistrationContractRegistry
        .filter((entry) => entry.speechProviderIds.length > 0)
        .map((entry) => entry.pluginId),
      predicate: (plugin) =>
        plugin.origin === "bundled" && (plugin.contracts?.speechProviders?.length ?? 0) > 0,
    });
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

  it("keeps native web provider implementations out of the TypeScript registry", () => {
    expect(webFetchProviderContractRegistry).toEqual([]);
    expect(webSearchProviderContractRegistry).toEqual([]);
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

  it("does not hydrate bundled web search provider objects in TypeScript", () => {
    expect(webSearchProviderContractRegistry).toEqual([]);
  });
});
