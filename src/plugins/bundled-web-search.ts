import {
  BUNDLED_WEB_SEARCH_PLUGIN_IDS,
  BUNDLED_WEB_SEARCH_PROVIDER_PLUGIN_IDS,
} from "./bundled-capability-metadata.js";
import type { PluginLoadOptions } from "./loader.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
import { listNativeWebSearchProviderEntries } from "./native-web-provider-entries.js";
import type { PluginWebSearchProviderEntry } from "./types.js";

export function resolveBundledWebSearchPluginIds(params: {
  config?: PluginLoadOptions["config"];
  workspaceDir?: string;
  env?: PluginLoadOptions["env"];
}): string[] {
  const bundledWebSearchPluginIdSet = new Set<string>(BUNDLED_WEB_SEARCH_PLUGIN_IDS);
  return loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  })
    .plugins.filter(
      (plugin) => plugin.origin === "bundled" && bundledWebSearchPluginIdSet.has(plugin.id),
    )
    .map((plugin) => plugin.id)
    .toSorted((left, right) => left.localeCompare(right));
}

export function listBundledWebSearchPluginIds(): string[] {
  return [...BUNDLED_WEB_SEARCH_PLUGIN_IDS];
}

export function listBundledWebSearchProviders(): PluginWebSearchProviderEntry[] {
  return listNativeWebSearchProviderEntries();
}

export function resolveBundledWebSearchPluginId(
  providerId: string | undefined,
): string | undefined {
  if (!providerId) {
    return undefined;
  }
  const normalizedProviderId = providerId.trim().toLowerCase();
  if (!(normalizedProviderId in BUNDLED_WEB_SEARCH_PROVIDER_PLUGIN_IDS)) {
    return undefined;
  }
  return BUNDLED_WEB_SEARCH_PROVIDER_PLUGIN_IDS[normalizedProviderId];
}
