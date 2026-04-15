import { listPotentialConfiguredChannelIds } from "../channels/config-presence.js";
import type { CrawClawConfig } from "../config/config.js";
import { BUNDLED_WEB_FETCH_PLUGIN_IDS } from "./bundled-web-fetch-ids.js";
import { BUNDLED_WEB_SEARCH_PLUGIN_IDS } from "./bundled-web-search-ids.js";
import { normalizePluginsConfig, resolveEffectivePluginActivationState } from "./config-state.js";
import { loadPluginManifestRegistry, type PluginManifestRecord } from "./manifest-registry.js";
import { hasKind } from "./slots.js";

const GATEWAY_STARTUP_RUNTIME_PLUGIN_IDS = new Set([
  ...BUNDLED_WEB_SEARCH_PLUGIN_IDS,
  ...BUNDLED_WEB_FETCH_PLUGIN_IDS,
]);

function hasRuntimeContractSurface(plugin: PluginManifestRecord): boolean {
  return Boolean(
    plugin.providers.length > 0 ||
    plugin.cliBackends.length > 0 ||
    plugin.contracts?.speechProviders?.length ||
    plugin.contracts?.mediaUnderstandingProviders?.length ||
    plugin.contracts?.webFetchProviders?.length ||
    plugin.contracts?.webSearchProviders?.length ||
    hasKind(plugin.kind, "memory"),
  );
}

function isGatewayStartupSidecar(plugin: PluginManifestRecord): boolean {
  return plugin.channels.length === 0 && !hasRuntimeContractSurface(plugin);
}

export function resolveChannelPluginIds(params: {
  config: CrawClawConfig;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
}): string[] {
  return loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  })
    .plugins.filter((plugin) => plugin.channels.length > 0)
    .map((plugin) => plugin.id);
}

export function resolveConfiguredChannelPluginIds(params: {
  config: CrawClawConfig;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
}): string[] {
  const configuredChannelIds = new Set(
    listPotentialConfiguredChannelIds(params.config, params.env).map((id) => id.trim()),
  );
  if (configuredChannelIds.size === 0) {
    return [];
  }
  return resolveChannelPluginIds(params).filter((pluginId) => configuredChannelIds.has(pluginId));
}

export function resolveConfiguredDeferredChannelPluginIds(params: {
  config: CrawClawConfig;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
}): string[] {
  const configuredChannelIds = new Set(
    listPotentialConfiguredChannelIds(params.config, params.env).map((id) => id.trim()),
  );
  if (configuredChannelIds.size === 0) {
    return [];
  }
  return loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  })
    .plugins.filter(
      (plugin) =>
        plugin.channels.some((channelId) => configuredChannelIds.has(channelId)) &&
        plugin.startupDeferConfiguredChannelFullLoadUntilAfterListen === true,
    )
    .map((plugin) => plugin.id);
}

export function resolveGatewayStartupPluginIds(params: {
  config: CrawClawConfig;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
}): string[] {
  const configuredChannelIds = new Set(
    listPotentialConfiguredChannelIds(params.config, params.env).map((id) => id.trim()),
  );
  const pluginsConfig = normalizePluginsConfig(params.config.plugins);
  return loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  })
    .plugins.filter((plugin) => {
      if (plugin.channels.some((channelId) => configuredChannelIds.has(channelId))) {
        return true;
      }
      const activationState = resolveEffectivePluginActivationState({
        id: plugin.id,
        origin: plugin.origin,
        config: pluginsConfig,
        rootConfig: params.config,
        enabledByDefault: plugin.enabledByDefault,
      });
      if (!activationState.enabled) {
        return false;
      }
      if (GATEWAY_STARTUP_RUNTIME_PLUGIN_IDS.has(plugin.id)) {
        if (plugin.origin !== "bundled") {
          return activationState.explicitlyEnabled;
        }
        return activationState.source === "explicit" || activationState.source === "default";
      }
      if (!isGatewayStartupSidecar(plugin)) {
        return false;
      }
      if (plugin.origin !== "bundled") {
        return activationState.explicitlyEnabled;
      }
      return activationState.source === "explicit" || activationState.source === "default";
    })
    .map((plugin) => plugin.id);
}
