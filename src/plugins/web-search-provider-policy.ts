const API_KEYLESS_BUNDLED_WEB_SEARCH_PLUGIN_IDS = new Set(["open-websearch"]);
const API_KEY_BUNDLED_WEB_SEARCH_PLUGIN_IDS = new Set([
  "brave",
  "exa",
  "google",
  "moonshot",
  "perplexity",
  "xai",
]);

export function isApiKeylessBundledWebSearchPluginId(pluginId: string | undefined): boolean {
  if (!pluginId) {
    return false;
  }
  return API_KEYLESS_BUNDLED_WEB_SEARCH_PLUGIN_IDS.has(pluginId.trim().toLowerCase());
}

export function isApiKeyBundledWebSearchPluginId(pluginId: string | undefined): boolean {
  if (!pluginId) {
    return false;
  }
  return API_KEY_BUNDLED_WEB_SEARCH_PLUGIN_IDS.has(pluginId.trim().toLowerCase());
}

export function filterApiKeylessBundledWebSearchPluginIds(
  pluginIds: readonly string[] | undefined,
): string[] {
  return (pluginIds ?? []).filter((pluginId) => isApiKeylessBundledWebSearchPluginId(pluginId));
}
