import type { CrawClawConfig } from "../config/config.js";
import { BUNDLED_NATIVE_WEB_SEARCH_PROVIDERS } from "./bundled-capability-metadata.js";
import { resolveBundledPluginWebSearchProviders } from "./web-search-providers.js";

export function resolveBundledWebSearchProviderEntries(
  params: Parameters<typeof resolveBundledPluginWebSearchProviders>[0],
) {
  return resolveBundledPluginWebSearchProviders(params);
}

function hasConfiguredCredentialValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== undefined && value !== null;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasNativeWebSearchCredential(params: {
  config: CrawClawConfig;
  env?: NodeJS.ProcessEnv;
}): boolean {
  return BUNDLED_NATIVE_WEB_SEARCH_PROVIDERS.some((provider) => {
    const pluginConfig = readRecord(
      (params.config.plugins?.entries as Record<string, { config?: unknown }> | undefined)?.[
        provider.pluginId
      ]?.config,
    );
    const webSearch = readRecord(pluginConfig?.webSearch);
    return (
      hasConfiguredCredentialValue(webSearch?.baseUrl) ||
      provider.envVars.some((envVar) => hasConfiguredCredentialValue(params.env?.[envVar]))
    );
  });
}

export function hasBundledWebSearchCredential(params: {
  config: CrawClawConfig;
  env?: NodeJS.ProcessEnv;
  searchConfig?: Record<string, unknown>;
}): boolean {
  if (hasNativeWebSearchCredential(params)) {
    return true;
  }
  const searchConfig =
    params.searchConfig ??
    (params.config.tools?.web?.search as Record<string, unknown> | undefined);
  return resolveBundledPluginWebSearchProviders({
    config: params.config,
    env: params.env,
    bundledAllowlistCompat: true,
  }).some((provider) => {
    const configuredCredential =
      provider.getConfiguredCredentialValue?.(params.config) ??
      provider.getCredentialValue(searchConfig);
    if (hasConfiguredCredentialValue(configuredCredential)) {
      return true;
    }
    return provider.envVars.some((envVar) => hasConfiguredCredentialValue(params.env?.[envVar]));
  });
}
