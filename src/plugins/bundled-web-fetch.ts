import {
  BUNDLED_WEB_FETCH_PLUGIN_IDS,
  BUNDLED_WEB_FETCH_PROVIDER_PLUGIN_IDS,
} from "./bundled-capability-metadata.js";
import { listNativeWebFetchProviderEntries } from "./native-web-provider-entries.js";
import type { PluginWebFetchProviderEntry } from "./types.js";

export function resolveBundledWebFetchPluginIds(_params?: unknown): string[] {
  return [...BUNDLED_WEB_FETCH_PLUGIN_IDS];
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
