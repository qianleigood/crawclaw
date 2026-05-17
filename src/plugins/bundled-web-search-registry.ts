import type { CrawClawConfig } from "../config/config.js";
import { resolveBundledPluginWebSearchProviders } from "./web-search-providers.js";

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

function hasNativeSearxngCredential(params: {
  config: CrawClawConfig;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const pluginConfig = readRecord(params.config.plugins?.entries?.searxng?.config);
  const webSearch = readRecord(pluginConfig?.webSearch);
  return (
    hasConfiguredCredentialValue(webSearch?.baseUrl) ||
    hasConfiguredCredentialValue(params.env?.SEARXNG_BASE_URL)
  );
}

export function hasBundledWebSearchCredential(params: {
  config: CrawClawConfig;
  env?: NodeJS.ProcessEnv;
  searchConfig?: Record<string, unknown>;
}): boolean {
  if (hasNativeSearxngCredential(params)) {
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
