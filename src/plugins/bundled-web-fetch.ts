import type { CrawClawConfig } from "../config/config.js";
import {
  BUNDLED_WEB_FETCH_PLUGIN_IDS,
  BUNDLED_WEB_FETCH_PROVIDER_PLUGIN_IDS,
} from "./bundled-capability-metadata.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
import { listNativeWebFetchProviderEntries } from "./native-web-provider-entries.js";
import type { PluginWebFetchProviderEntry } from "./types.js";

export function resolveBundledWebFetchPluginIds(params: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const bundledWebFetchPluginIdSet = new Set<string>(BUNDLED_WEB_FETCH_PLUGIN_IDS);
  return loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  })
    .plugins.filter(
      (plugin) => plugin.origin === "bundled" && bundledWebFetchPluginIdSet.has(plugin.id),
    )
    .map((plugin) => plugin.id)
    .toSorted((left, right) => left.localeCompare(right));
}

export function listBundledWebFetchProviders(): PluginWebFetchProviderEntry[] {
  return listNativeWebFetchProviderEntries();
}

export function resolveBundledWebFetchPluginId(providerId: string | undefined): string | undefined {
  if (!providerId) {
    return undefined;
  }
  const normalizedProviderId = providerId.trim().toLowerCase();
  if (!(normalizedProviderId in BUNDLED_WEB_FETCH_PROVIDER_PLUGIN_IDS)) {
    return undefined;
  }
  return BUNDLED_WEB_FETCH_PROVIDER_PLUGIN_IDS[normalizedProviderId];
}
