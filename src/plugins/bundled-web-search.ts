import {
  BUNDLED_WEB_SEARCH_PLUGIN_IDS,
  BUNDLED_WEB_SEARCH_PROVIDER_PLUGIN_IDS,
} from "./bundled-capability-metadata.js";
import { listNativeWebSearchProviderEntries } from "./native-web-provider-entries.js";
import type { PluginWebSearchProviderEntry } from "./types.js";

export function resolveBundledWebSearchPluginIds(_params?: unknown): string[] {
  return listBundledWebSearchPluginIds();
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
