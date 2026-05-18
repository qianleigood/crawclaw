import type { CrawClawConfig } from "../config/config.js";
import {
  BUNDLED_NATIVE_WEB_FETCH_PROVIDERS,
  BUNDLED_NATIVE_WEB_SEARCH_PROVIDERS,
} from "./bundled-capability-metadata.js";
import { enablePluginInConfig } from "./enable.js";
import type { PluginWebFetchProviderEntry, PluginWebSearchProviderEntry } from "./types.js";

function pluginConfigEntry(config: CrawClawConfig | undefined, pluginId: string) {
  return (
    config?.plugins?.entries as Record<string, { config?: Record<string, unknown> }> | undefined
  )?.[pluginId]?.config;
}

function readNestedPluginConfig(
  config: CrawClawConfig | undefined,
  pluginId: string,
  section: "webFetch" | "webSearch",
  key: string,
): unknown {
  const sectionConfig = pluginConfigEntry(config, pluginId)?.[section];
  if (!sectionConfig || typeof sectionConfig !== "object" || Array.isArray(sectionConfig)) {
    return undefined;
  }
  return (sectionConfig as Record<string, unknown>)[key];
}

function writeNestedPluginConfig(
  config: CrawClawConfig,
  pluginId: string,
  section: "webFetch" | "webSearch",
  key: string,
  value: unknown,
): void {
  const plugins = (config.plugins ??= {});
  const entries = (plugins.entries ??= {}) as Record<string, Record<string, unknown>>;
  const entry = (entries[pluginId] ??= {});
  const pluginConfig = (entry.config ??= {}) as Record<string, unknown>;
  const sectionConfig = (pluginConfig[section] ??= {}) as Record<string, unknown>;
  sectionConfig[key] = value;
}

export function listNativeWebSearchProviderEntries(): PluginWebSearchProviderEntry[] {
  return BUNDLED_NATIVE_WEB_SEARCH_PROVIDERS.map((provider) => ({
    id: provider.id,
    pluginId: provider.pluginId,
    label: provider.label,
    hint: provider.hint,
    onboardingScopes: [...provider.onboardingScopes],
    requiresCredential: provider.requiresCredential,
    envVars: [...provider.envVars],
    placeholder: provider.placeholder,
    signupUrl: provider.signupUrl,
    docsUrl: provider.docsUrl,
    credentialPath: `plugins.entries.${provider.pluginId}.config.webSearch.baseUrl`,
    getCredentialValue: () => undefined,
    setCredentialValue: () => {},
    getConfiguredCredentialValue: (config) =>
      readNestedPluginConfig(config, provider.pluginId, "webSearch", "baseUrl"),
    setConfiguredCredentialValue: (config, value) =>
      writeNestedPluginConfig(config, provider.pluginId, "webSearch", "baseUrl", value),
    applySelectionConfig: (config) => enablePluginInConfig(config, provider.pluginId).config,
  }));
}

export function listNativeWebFetchProviderEntries(): PluginWebFetchProviderEntry[] {
  return BUNDLED_NATIVE_WEB_FETCH_PROVIDERS.map((provider) => ({
    id: provider.id,
    pluginId: provider.pluginId,
    label: provider.label,
    hint: provider.hint,
    requiresCredential: provider.requiresCredential,
    envVars: [...provider.envVars],
    placeholder: provider.placeholder,
    signupUrl: provider.signupUrl,
    docsUrl: provider.docsUrl,
    credentialPath: `plugins.entries.${provider.pluginId}.config.webFetch.baseUrl`,
    getCredentialValue: () => undefined,
    setCredentialValue: () => {},
    getConfiguredCredentialValue: (config) =>
      readNestedPluginConfig(config, provider.pluginId, "webFetch", "baseUrl"),
    setConfiguredCredentialValue: (config, value) =>
      writeNestedPluginConfig(config, provider.pluginId, "webFetch", "baseUrl", value),
    applySelectionConfig: (config) => enablePluginInConfig(config, provider.pluginId).config,
  }));
}
