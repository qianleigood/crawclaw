import { BUNDLED_WEB_SEARCH_PLUGIN_IDS } from "./bundled-capability-metadata.js";
import { resolveBundledWebSearchPluginId as resolveBundledWebSearchPluginIdFromMap } from "./bundled-web-search-provider-ids.js";
import type { PluginLoadOptions } from "./loader.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
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
  return [];
}

export function resolveBundledWebSearchPluginId(
  providerId: string | undefined,
): string | undefined {
  return resolveBundledWebSearchPluginIdFromMap(providerId);
}
