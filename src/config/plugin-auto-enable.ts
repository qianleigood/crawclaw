import { normalizeProviderId } from "../agents/model-selection.js";
import { BUNDLED_AUTO_ENABLE_PROVIDER_PLUGIN_IDS } from "../plugins/bundled-capability-metadata.js";
import type { PluginManifestRegistry } from "../plugins/manifest-registry.js";
import { isRecord } from "../utils.js";
import type { CrawClawConfig } from "./config.js";
import { ensurePluginAllowlisted } from "./plugins-allowlist.js";

type PluginEnableChange = {
  pluginId: string;
  reason: string;
};

export type PluginAutoEnableResult = {
  config: CrawClawConfig;
  changes: string[];
  autoEnabledReasons: Record<string, string[]>;
};

function hasProviderConfig(cfg: CrawClawConfig, providerId: string): boolean {
  const normalized = normalizeProviderId(providerId);
  if (!normalized) {
    return false;
  }
  const providerConfig = cfg.models?.providers?.[normalized];
  if (isRecord(providerConfig) && Object.keys(providerConfig).length > 0) {
    return true;
  }
  return Object.values(cfg.auth?.profiles ?? {}).some((profile) => {
    if (!isRecord(profile)) {
      return false;
    }
    const provider =
      typeof profile.provider === "string" ? normalizeProviderId(profile.provider) : "";
    return provider === normalized;
  });
}

function collectConfiguredProviderPlugins(cfg: CrawClawConfig): PluginEnableChange[] {
  const changes: PluginEnableChange[] = [];
  for (const [providerId, pluginId] of Object.entries(BUNDLED_AUTO_ENABLE_PROVIDER_PLUGIN_IDS)) {
    if (hasProviderConfig(cfg, providerId)) {
      changes.push({ pluginId, reason: `${providerId} auth configured` });
    }
  }
  return changes;
}

function isPluginDenied(cfg: CrawClawConfig, pluginId: string): boolean {
  const deny = cfg.plugins?.deny;
  return Array.isArray(deny) && deny.includes(pluginId);
}

function isPluginEnabled(cfg: CrawClawConfig, pluginId: string): boolean {
  return cfg.plugins?.entries?.[pluginId]?.enabled === true;
}

function enablePluginEntry(cfg: CrawClawConfig, pluginId: string): CrawClawConfig {
  const entries = {
    ...cfg.plugins?.entries,
    [pluginId]: {
      ...(cfg.plugins?.entries?.[pluginId] as Record<string, unknown> | undefined),
      enabled: true,
    },
  };
  return ensurePluginAllowlisted(
    {
      ...cfg,
      plugins: {
        ...cfg.plugins,
        entries,
      },
    },
    pluginId,
  );
}

export function applyPluginAutoEnable(params: {
  config?: CrawClawConfig;
  env?: NodeJS.ProcessEnv;
  manifestRegistry?: PluginManifestRegistry;
}): PluginAutoEnableResult {
  void params.env;
  void params.manifestRegistry;
  let config = params.config ?? ({} as CrawClawConfig);
  const changes: string[] = [];
  const autoEnabledReasons = new Map<string, string[]>();
  if (config.plugins?.enabled === false) {
    return { config, changes, autoEnabledReasons: {} };
  }
  for (const entry of collectConfiguredProviderPlugins(config)) {
    if (isPluginDenied(config, entry.pluginId) || isPluginEnabled(config, entry.pluginId)) {
      continue;
    }
    config = enablePluginEntry(config, entry.pluginId);
    changes.push(`${entry.reason}, enabled automatically.`);
    autoEnabledReasons.set(entry.pluginId, [
      ...(autoEnabledReasons.get(entry.pluginId) ?? []),
      entry.reason,
    ]);
  }
  return {
    config,
    changes,
    autoEnabledReasons: Object.fromEntries(autoEnabledReasons.entries()),
  };
}
