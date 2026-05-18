import {
  BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS,
  BUNDLED_SPEECH_PLUGIN_IDS,
} from "../bundled-capability-metadata.js";
import { loadBundledCapabilityRuntimeRegistry } from "../bundled-capability-runtime.js";
import type { SpeechProviderPlugin } from "../types.js";
import { loadVitestSpeechProviderContractRegistry } from "./speech-vitest-registry.js";

type CapabilityContractEntry<T> = {
  pluginId: string;
  provider: T;
};

type SpeechProviderContractEntry = CapabilityContractEntry<SpeechProviderPlugin>;
type PluginRegistrationContractEntry = {
  pluginId: string;
  providerIds: string[];
  speechProviderIds: string[];
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

let speechProviderContractRegistryCache: SpeechProviderContractEntry[] | null = null;
export let providerContractLoadError: Error | undefined = undefined;

function loadSpeechProviderContractRegistry(): SpeechProviderContractEntry[] {
  if (!speechProviderContractRegistryCache) {
    speechProviderContractRegistryCache = process.env.VITEST
      ? loadVitestSpeechProviderContractRegistry()
      : loadBundledCapabilityRuntimeRegistry({
          pluginIds: BUNDLED_SPEECH_PLUGIN_IDS,
        }).speechProviders.map((entry) => ({
          pluginId: entry.pluginId,
          provider: entry.provider,
        }));
  }
  return speechProviderContractRegistryCache;
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

export const speechProviderContractRegistry: SpeechProviderContractEntry[] = createLazyArrayView(
  loadSpeechProviderContractRegistry,
);

function loadPluginRegistrationContractRegistry(): PluginRegistrationContractEntry[] {
  return BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.map((entry) => ({
    pluginId: entry.pluginId,
    providerIds: uniqueStrings(entry.providerIds),
    speechProviderIds: uniqueStrings(entry.speechProviderIds),
    webFetchProviderIds: uniqueStrings(entry.webFetchProviderIds),
    webSearchProviderIds: uniqueStrings(entry.webSearchProviderIds),
    toolNames: uniqueStrings(entry.toolNames),
  }));
}

export const pluginRegistrationContractRegistry: PluginRegistrationContractEntry[] =
  createLazyArrayView(loadPluginRegistrationContractRegistry);
