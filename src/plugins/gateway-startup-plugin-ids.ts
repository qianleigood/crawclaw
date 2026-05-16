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
    plugin.contracts?.speechProviders?.length ||
    plugin.contracts?.webFetchProviders?.length ||
    plugin.contracts?.webSearchProviders?.length ||
    plugin.contracts?.tools?.length ||
    hasKind(plugin.kind, "memory"),
  );
}

function isGatewayStartupSidecar(plugin: PluginManifestRecord): boolean {
  return !hasRuntimeContractSurface(plugin);
}

export function resolveGatewayStartupPluginIds(params: {
  config: CrawClawConfig;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
}): string[] {
  const pluginsConfig = normalizePluginsConfig(params.config.plugins);
  return loadPluginManifestRegistry({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  })
    .plugins.filter((plugin) => {
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
