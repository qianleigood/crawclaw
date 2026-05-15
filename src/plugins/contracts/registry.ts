import {
  BUNDLED_MEDIA_UNDERSTANDING_PLUGIN_IDS,
  BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS,
  BUNDLED_SPEECH_PLUGIN_IDS,
  BUNDLED_WEB_FETCH_PLUGIN_IDS,
  BUNDLED_WEB_SEARCH_PLUGIN_IDS,
} from "../bundled-capability-metadata.js";
import { loadBundledCapabilityRuntimeRegistry } from "../bundled-capability-runtime.js";
import type {
  MediaUnderstandingProviderPlugin,
  SpeechProviderPlugin,
  WebFetchProviderPlugin,
  WebSearchProviderPlugin,
} from "../types.js";
import {
  loadVitestMediaUnderstandingProviderContractRegistry,
  loadVitestSpeechProviderContractRegistry,
} from "./speech-vitest-registry.js";

type BundledCapabilityRuntimeRegistry = ReturnType<typeof loadBundledCapabilityRuntimeRegistry>;
type CapabilityContractEntry<T> = {
  pluginId: string;
  provider: T;
};

type WebSearchProviderContractEntry = CapabilityContractEntry<WebSearchProviderPlugin> & {
  credentialValue: unknown;
};
type WebFetchProviderContractEntry = CapabilityContractEntry<WebFetchProviderPlugin> & {
  credentialValue: unknown;
};

type SpeechProviderContractEntry = CapabilityContractEntry<SpeechProviderPlugin>;
type MediaUnderstandingProviderContractEntry =
  CapabilityContractEntry<MediaUnderstandingProviderPlugin>;
type PluginRegistrationContractEntry = {
  pluginId: string;
  cliBackendIds: string[];
  providerIds: string[];
  speechProviderIds: string[];
  mediaUnderstandingProviderIds: string[];
  webFetchProviderIds: string[];
  webSearchProviderIds: string[];
  toolNames: string[];
};

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

let webFetchProviderContractRegistryCache: WebFetchProviderContractEntry[] | null = null;
let webFetchProviderContractRegistryByPluginIdCache: Map<
  string,
  WebFetchProviderContractEntry[]
> | null = null;
let webSearchProviderContractRegistryCache: WebSearchProviderContractEntry[] | null = null;
let webSearchProviderContractRegistryByPluginIdCache: Map<
  string,
  WebSearchProviderContractEntry[]
> | null = null;
let speechProviderContractRegistryCache: SpeechProviderContractEntry[] | null = null;
let mediaUnderstandingProviderContractRegistryCache:
  | MediaUnderstandingProviderContractEntry[]
  | null = null;
export let providerContractLoadError: Error | undefined = undefined;

function formatBundledCapabilityPluginLoadError(params: {
  pluginId: string;
  capabilityLabel: string;
  registry: BundledCapabilityRuntimeRegistry;
}): Error {
  const plugin = params.registry.plugins.find((entry) => entry.id === params.pluginId);
  const diagnostics = params.registry.diagnostics
    .filter((entry) => entry.pluginId === params.pluginId)
    .map((entry) => entry.message);
  const detailParts = plugin
    ? [
        `status=${plugin.status}`,
        ...(plugin.error ? [`error=${plugin.error}`] : []),
        `providerIds=[${plugin.providerIds.join(", ")}]`,
        `webFetchProviderIds=[${plugin.webFetchProviderIds.join(", ")}]`,
        `webSearchProviderIds=[${plugin.webSearchProviderIds.join(", ")}]`,
      ]
    : ["plugin record missing"];
  if (diagnostics.length > 0) {
    detailParts.push(`diagnostics=${diagnostics.join(" | ")}`);
  }
  return new Error(
    `bundled ${params.capabilityLabel} contract load failed for ${params.pluginId}: ${detailParts.join("; ")}`,
  );
}

function loadScopedCapabilityRuntimeRegistryEntries<T>(params: {
  pluginId: string;
  capabilityLabel: string;
  loadEntries: (registry: BundledCapabilityRuntimeRegistry) => T[];
  loadDeclaredIds: (
    plugin: BundledCapabilityRuntimeRegistry["plugins"][number],
  ) => readonly string[];
}): T[] {
  let lastFailure: Error | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const registry = loadBundledCapabilityRuntimeRegistry({
      pluginIds: [params.pluginId],
      pluginSdkResolution: "dist",
    });
    const entries = params.loadEntries(registry);
    if (entries.length > 0) {
      return entries;
    }

    const plugin = registry.plugins.find((entry) => entry.id === params.pluginId);
    lastFailure = formatBundledCapabilityPluginLoadError({
      pluginId: params.pluginId,
      capabilityLabel: params.capabilityLabel,
      registry,
    });
    const shouldRetry =
      attempt === 0 &&
      (!plugin || plugin.status !== "loaded" || params.loadDeclaredIds(plugin).length === 0);
    if (!shouldRetry) {
      break;
    }
  }

  throw (
    lastFailure ??
    new Error(
      `bundled ${params.capabilityLabel} contract load failed for ${params.pluginId}: no entries`,
    )
  );
}

function resolveWebSearchCredentialValue(provider: WebSearchProviderPlugin): unknown {
  if (provider.requiresCredential === false) {
    return `${provider.id}-no-key-needed`;
  }
  const envVar = provider.envVars.find((entry) => entry.trim().length > 0);
  if (!envVar) {
    return `${provider.id}-test`;
  }
  if (envVar === "OPENROUTER_API_KEY") {
    return "openrouter-test";
  }
  return envVar.toLowerCase().includes("api_key") ? `${provider.id}-test` : "sk-test";
}

function resolveWebFetchCredentialValue(provider: WebFetchProviderPlugin): unknown {
  if (provider.requiresCredential === false) {
    return `${provider.id}-no-key-needed`;
  }
  const envVar = provider.envVars.find((entry) => entry.trim().length > 0);
  if (!envVar) {
    return `${provider.id}-test`;
  }
  return envVar.toLowerCase().includes("api_key") ? `${provider.id}-test` : "sk-test";
}

function loadWebFetchProviderContractRegistry(): WebFetchProviderContractEntry[] {
  if (!webFetchProviderContractRegistryCache) {
    const registry = loadBundledCapabilityRuntimeRegistry({
      pluginIds: BUNDLED_WEB_FETCH_PLUGIN_IDS,
      pluginSdkResolution: "dist",
    });
    webFetchProviderContractRegistryCache = registry.webFetchProviders.map((entry) => ({
      pluginId: entry.pluginId,
      provider: entry.provider,
      credentialValue: resolveWebFetchCredentialValue(entry.provider),
    }));
  }
  return webFetchProviderContractRegistryCache;
}

export function resolveWebFetchProviderContractEntriesForPluginId(
  pluginId: string,
): WebFetchProviderContractEntry[] {
  if (webFetchProviderContractRegistryCache) {
    return webFetchProviderContractRegistryCache.filter((entry) => entry.pluginId === pluginId);
  }

  const cache =
    webFetchProviderContractRegistryByPluginIdCache ??
    new Map<string, WebFetchProviderContractEntry[]>();
  webFetchProviderContractRegistryByPluginIdCache = cache;
  const cached = cache.get(pluginId);
  if (cached) {
    return cached;
  }

  const entries = loadScopedCapabilityRuntimeRegistryEntries({
    pluginId,
    capabilityLabel: "web fetch provider",
    loadEntries: (registry) =>
      registry.webFetchProviders
        .filter((entry) => entry.pluginId === pluginId)
        .map((entry) => ({
          pluginId: entry.pluginId,
          provider: entry.provider,
          credentialValue: resolveWebFetchCredentialValue(entry.provider),
        })),
    loadDeclaredIds: (plugin) => plugin.webFetchProviderIds,
  });
  cache.set(pluginId, entries);
  return entries;
}

function loadWebSearchProviderContractRegistry(): WebSearchProviderContractEntry[] {
  if (!webSearchProviderContractRegistryCache) {
    const registry = loadBundledCapabilityRuntimeRegistry({
      pluginIds: BUNDLED_WEB_SEARCH_PLUGIN_IDS,
      pluginSdkResolution: "dist",
    });
    webSearchProviderContractRegistryCache = registry.webSearchProviders.map((entry) => ({
      pluginId: entry.pluginId,
      provider: entry.provider,
      credentialValue: resolveWebSearchCredentialValue(entry.provider),
    }));
  }
  return webSearchProviderContractRegistryCache;
}

export function resolveWebSearchProviderContractEntriesForPluginId(
  pluginId: string,
): WebSearchProviderContractEntry[] {
  if (webSearchProviderContractRegistryCache) {
    return webSearchProviderContractRegistryCache.filter((entry) => entry.pluginId === pluginId);
  }

  const cache =
    webSearchProviderContractRegistryByPluginIdCache ??
    new Map<string, WebSearchProviderContractEntry[]>();
  webSearchProviderContractRegistryByPluginIdCache = cache;
  const cached = cache.get(pluginId);
  if (cached) {
    return cached;
  }

  const entries = loadScopedCapabilityRuntimeRegistryEntries({
    pluginId,
    capabilityLabel: "web search provider",
    loadEntries: (registry) =>
      registry.webSearchProviders
        .filter((entry) => entry.pluginId === pluginId)
        .map((entry) => ({
          pluginId: entry.pluginId,
          provider: entry.provider,
          credentialValue: resolveWebSearchCredentialValue(entry.provider),
        })),
    loadDeclaredIds: (plugin) => plugin.webSearchProviderIds,
  });
  cache.set(pluginId, entries);
  return entries;
}

function loadSpeechProviderContractRegistry(): SpeechProviderContractEntry[] {
  if (!speechProviderContractRegistryCache) {
    speechProviderContractRegistryCache = process.env.VITEST
      ? loadVitestSpeechProviderContractRegistry()
      : loadBundledCapabilityRuntimeRegistry({
          pluginIds: BUNDLED_SPEECH_PLUGIN_IDS,
          pluginSdkResolution: "dist",
        }).speechProviders.map((entry) => ({
          pluginId: entry.pluginId,
          provider: entry.provider,
        }));
  }
  return speechProviderContractRegistryCache;
}

function loadMediaUnderstandingProviderContractRegistry(): MediaUnderstandingProviderContractEntry[] {
  if (!mediaUnderstandingProviderContractRegistryCache) {
    mediaUnderstandingProviderContractRegistryCache = process.env.VITEST
      ? loadVitestMediaUnderstandingProviderContractRegistry()
      : loadBundledCapabilityRuntimeRegistry({
          pluginIds: BUNDLED_MEDIA_UNDERSTANDING_PLUGIN_IDS,
          pluginSdkResolution: "dist",
        }).mediaUnderstandingProviders.map((entry) => ({
          pluginId: entry.pluginId,
          provider: entry.provider,
        }));
  }
  return mediaUnderstandingProviderContractRegistryCache;
}

function createLazyArrayView<T>(load: () => T[]): T[] {
  return new Proxy([] as T[], {
    get(_target, prop) {
      const actual = load();
      const value = Reflect.get(actual, prop, actual);
      return typeof value === "function" ? value.bind(actual) : value;
    },
    has(_target, prop) {
      return Reflect.has(load(), prop);
    },
    ownKeys() {
      return Reflect.ownKeys(load());
    },
    getOwnPropertyDescriptor(_target, prop) {
      const actual = load();
      const descriptor = Reflect.getOwnPropertyDescriptor(actual, prop);
      if (descriptor) {
        return descriptor;
      }
      if (Reflect.has(actual, prop)) {
        return {
          configurable: true,
          enumerable: true,
          writable: false,
          value: Reflect.get(actual, prop, actual),
        };
      }
      return undefined;
    },
  });
}

export const webSearchProviderContractRegistry: WebSearchProviderContractEntry[] =
  createLazyArrayView(loadWebSearchProviderContractRegistry);

export const webFetchProviderContractRegistry: WebFetchProviderContractEntry[] =
  createLazyArrayView(loadWebFetchProviderContractRegistry);

export const speechProviderContractRegistry: SpeechProviderContractEntry[] = createLazyArrayView(
  loadSpeechProviderContractRegistry,
);

export const mediaUnderstandingProviderContractRegistry: MediaUnderstandingProviderContractEntry[] =
  createLazyArrayView(loadMediaUnderstandingProviderContractRegistry);

function loadPluginRegistrationContractRegistry(): PluginRegistrationContractEntry[] {
  return BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.map((entry) => ({
    pluginId: entry.pluginId,
    cliBackendIds: uniqueStrings(entry.cliBackendIds),
    providerIds: uniqueStrings(entry.providerIds),
    speechProviderIds: uniqueStrings(entry.speechProviderIds),
    mediaUnderstandingProviderIds: uniqueStrings(entry.mediaUnderstandingProviderIds),
    webFetchProviderIds: uniqueStrings(entry.webFetchProviderIds),
    webSearchProviderIds: uniqueStrings(entry.webSearchProviderIds),
    toolNames: uniqueStrings(entry.toolNames),
  }));
}

export const pluginRegistrationContractRegistry: PluginRegistrationContractEntry[] =
  createLazyArrayView(loadPluginRegistrationContractRegistry);
