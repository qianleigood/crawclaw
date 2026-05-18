import { BUNDLED_WEB_SEARCH_PLUGIN_IDS } from "./bundled-capability-metadata.js";

const API_KEYLESS_BUNDLED_WEB_SEARCH_PLUGIN_IDS = new Set(BUNDLED_WEB_SEARCH_PLUGIN_IDS);

export function isApiKeylessBundledWebSearchPluginId(pluginId: string | undefined): boolean {
  if (!pluginId) {
    return false;
  }
  return API_KEYLESS_BUNDLED_WEB_SEARCH_PLUGIN_IDS.has(pluginId.trim().toLowerCase());
}

export function isApiKeyBundledWebSearchPluginId(_pluginId: string | undefined): boolean {
  return false;
}
