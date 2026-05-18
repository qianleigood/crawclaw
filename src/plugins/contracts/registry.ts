import { BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS } from "../bundled-capability-metadata.js";

type PluginRegistrationContractEntry = {
  pluginId: string;
  providerIds: string[];
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

function loadPluginRegistrationContractRegistry(): PluginRegistrationContractEntry[] {
  return BUNDLED_PLUGIN_CONTRACT_SNAPSHOTS.map((entry) => ({
    pluginId: entry.pluginId,
    providerIds: uniqueStrings(entry.providerIds),
    webFetchProviderIds: uniqueStrings(entry.webFetchProviderIds),
    webSearchProviderIds: uniqueStrings(entry.webSearchProviderIds),
    toolNames: uniqueStrings(entry.toolNames),
  }));
}

export const pluginRegistrationContractRegistry: PluginRegistrationContractEntry[] =
  createLazyArrayView(loadPluginRegistrationContractRegistry);
