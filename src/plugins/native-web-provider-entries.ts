import type { CrawClawConfig } from "../config/config.js";
import {
  BUNDLED_NATIVE_WEB_FETCH_PROVIDERS,
  BUNDLED_NATIVE_WEB_SEARCH_PROVIDERS,
  type BundledNativeWebProviderMetadata,
} from "./bundled-capability-metadata.js";
import { enablePluginInConfig } from "./enable.js";
import type { PluginWebFetchProviderEntry, PluginWebSearchProviderEntry } from "./types.js";

const WEB_DOCS_URL = "https://docs.crawclaw.ai/tools/web";

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

function providerHint(provider: BundledNativeWebProviderMetadata): string {
  if (provider.id === "searxng") {
    return "Use the bundled managed local SearXNG web search provider";
  }
  if (provider.id === "spider") {
    return "Use the bundled native static HTTP and browser-rendered fetch provider";
  }
  return `Use the bundled native ${provider.label} provider`;
}

export function listNativeWebSearchProviderEntries(): PluginWebSearchProviderEntry[] {
  return BUNDLED_NATIVE_WEB_SEARCH_PROVIDERS.map((provider) => ({
    id: provider.id,
    pluginId: provider.pluginId,
    label: provider.label,
    hint: providerHint(provider),
    onboardingScopes: ["text-inference"],
    requiresCredential: false,
    envVars: provider.id === "searxng" ? ["SEARXNG_BASE_URL"] : [],
    placeholder: "",
    signupUrl: WEB_DOCS_URL,
    docsUrl: WEB_DOCS_URL,
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
    hint: providerHint(provider),
    requiresCredential: false,
    envVars: [],
    placeholder: "",
    signupUrl: WEB_DOCS_URL,
    docsUrl: WEB_DOCS_URL,
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
