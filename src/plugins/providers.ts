import { normalizeProviderId } from "../agents/provider-id.js";
import type { CrawClawConfig } from "../config/config.js";
import { BUNDLED_PROVIDER_PLUGIN_IDS } from "./bundled-capability-metadata.js";
import { normalizePluginsConfig, resolveEffectivePluginActivationState } from "./config-state.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";

export function resolveBundledProviderCompatPluginIds(params: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  onlyPluginIds?: string[];
}): string[] {
  const onlyPluginIdSet = params.onlyPluginIds ? new Set(params.onlyPluginIds) : null;
  return BUNDLED_PROVIDER_PLUGIN_IDS.filter(
    (pluginId) => !onlyPluginIdSet || onlyPluginIdSet.has(pluginId),
  );
}

export function resolveEnabledProviderPluginIds(params: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  onlyPluginIds?: string[];
}): string[] {
  const onlyPluginIdSet = params.onlyPluginIds ? new Set(params.onlyPluginIds) : null;
  const registry = loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  });
  const normalizedConfig = normalizePluginsConfig(params.config?.plugins);
  return registry.plugins
    .filter(
      (plugin) =>
        plugin.providers.length > 0 &&
        (!onlyPluginIdSet || onlyPluginIdSet.has(plugin.id)) &&
        resolveEffectivePluginActivationState({
          id: plugin.id,
          origin: plugin.origin,
          config: normalizedConfig,
          rootConfig: params.config,
        }).activated,
    )
    .map((plugin) => plugin.id)
    .toSorted((left, right) => left.localeCompare(right));
}

export function resolveOwningPluginIdsForProvider(params: {
  provider: string;
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): string[] | undefined {
  const normalizedProvider = normalizeProviderId(params.provider);
  if (!normalizedProvider) {
    return undefined;
  }

  const registry = loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  });
  const pluginIds = registry.plugins
    .filter((plugin) =>
      plugin.providers.some((providerId) => normalizeProviderId(providerId) === normalizedProvider),
    )
    .map((plugin) => plugin.id);

  return pluginIds.length > 0 ? pluginIds : undefined;
}

export function resolveNonBundledProviderPluginIds(params: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const registry = loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  });
  const normalizedConfig = normalizePluginsConfig(params.config?.plugins);
  return registry.plugins
    .filter(
      (plugin) =>
        plugin.origin !== "bundled" &&
        plugin.providers.length > 0 &&
        resolveEffectivePluginActivationState({
          id: plugin.id,
          origin: plugin.origin,
          config: normalizedConfig,
          rootConfig: params.config,
        }).activated,
    )
    .map((plugin) => plugin.id)
    .toSorted((left, right) => left.localeCompare(right));
}

export function resolveCatalogHookProviderPluginIds(params: {
  config?: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const registry = loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  });
  const normalizedConfig = normalizePluginsConfig(params.config?.plugins);
  const enabledProviderPluginIds = registry.plugins
    .filter(
      (plugin) =>
        plugin.providers.length > 0 &&
        resolveEffectivePluginActivationState({
          id: plugin.id,
          origin: plugin.origin,
          config: normalizedConfig,
          rootConfig: params.config,
        }).activated,
    )
    .map((plugin) => plugin.id);
  const bundledCompatPluginIds = resolveBundledProviderCompatPluginIds(params);
  return [...new Set([...enabledProviderPluginIds, ...bundledCompatPluginIds])].toSorted(
    (left, right) => left.localeCompare(right),
  );
}
