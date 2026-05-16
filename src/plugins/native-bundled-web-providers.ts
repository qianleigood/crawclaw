import type { CrawClawConfig } from "../config/config.js";
import { enablePluginInConfig } from "./enable.js";
import type {
  PluginWebFetchProviderEntry,
  PluginWebSearchProviderEntry,
  WebFetchProviderPlugin,
  WebSearchProviderPlugin,
} from "./types.js";

const SEARXNG_PLUGIN_ID = "searxng";
const SEARXNG_PROVIDER_ID = "searxng";
const SPIDER_FETCH_PLUGIN_ID = "spider-fetch";
const SPIDER_FETCH_PROVIDER_ID = "spider";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function pluginConfig(
  config: CrawClawConfig | undefined,
  pluginId: string,
): Record<string, unknown> {
  return record(config?.plugins?.entries?.[pluginId]?.config) ?? {};
}

function scopedConfig(config: CrawClawConfig | undefined, pluginId: string, key: string) {
  return record(pluginConfig(config, pluginId)[key]);
}

function setPluginConfigValue(
  configTarget: CrawClawConfig,
  pluginId: string,
  scope: string,
  key: string,
  value: unknown,
) {
  const plugins = (configTarget.plugins ??= {});
  const entries = (plugins.entries ??= {});
  const pluginEntry = (entries[pluginId] ??= {});
  const config =
    pluginEntry.config &&
    typeof pluginEntry.config === "object" &&
    !Array.isArray(pluginEntry.config)
      ? pluginEntry.config
      : ((pluginEntry.config = {}), pluginEntry.config);
  const scoped =
    config[scope] && typeof config[scope] === "object" && !Array.isArray(config[scope])
      ? (config[scope] as Record<string, unknown>)
      : ((config[scope] = {}), config[scope] as Record<string, unknown>);
  scoped[key] = value;
}

function searxngProvider(): WebSearchProviderPlugin {
  return {
    id: SEARXNG_PROVIDER_ID,
    label: "SearXNG",
    hint: "Use the bundled managed SearXNG sidecar for keyless multi-engine web search",
    onboardingScopes: ["text-inference"],
    requiresCredential: false,
    credentialLabel: "SearXNG base URL override",
    envVars: ["SEARXNG_BASE_URL"],
    placeholder: "http://127.0.0.1:3210",
    signupUrl: "https://github.com/searxng/searxng",
    docsUrl: "https://docs.crawclaw.ai/tools/web",
    autoDetectOrder: 5,
    credentialPath: "plugins.entries.searxng.config.webSearch.baseUrl",
    inactiveSecretPaths: ["plugins.entries.searxng.config.webSearch.baseUrl"],
    getCredentialValue: (searchConfig) => record(searchConfig)?.[SEARXNG_PROVIDER_ID],
    setCredentialValue: (searchConfigTarget, value) => {
      searchConfigTarget[SEARXNG_PROVIDER_ID] = value;
    },
    getConfiguredCredentialValue: (config) =>
      scopedConfig(config, SEARXNG_PLUGIN_ID, "webSearch")?.baseUrl,
    setConfiguredCredentialValue: (configTarget, value) => {
      setPluginConfigValue(configTarget, SEARXNG_PLUGIN_ID, "webSearch", "baseUrl", value);
    },
    applySelectionConfig: (config) => enablePluginInConfig(config, SEARXNG_PLUGIN_ID).config,
  };
}

function spiderFetchProvider(): WebFetchProviderPlugin {
  return {
    id: SPIDER_FETCH_PROVIDER_ID,
    label: "Spider",
    hint: "Fetch pages through CrawClaw's Rust-native Spider provider.",
    requiresCredential: false,
    envVars: [],
    placeholder: "Select explicitly to use Spider-rendered fetch",
    signupUrl: "https://github.com/spider-rs/spider",
    docsUrl: "https://github.com/spider-rs/spider",
    autoDetectOrder: 0,
    credentialPath: "plugins.entries.spider-fetch.config.webFetch.timeoutSeconds",
    inactiveSecretPaths: [],
    getCredentialValue: (fetchConfig) => record(fetchConfig)?.[SPIDER_FETCH_PROVIDER_ID],
    setCredentialValue: (fetchConfigTarget, value) => {
      fetchConfigTarget[SPIDER_FETCH_PROVIDER_ID] = value;
    },
    getConfiguredCredentialValue: (config) =>
      scopedConfig(config, SPIDER_FETCH_PLUGIN_ID, "webFetch")?.timeoutSeconds,
    setConfiguredCredentialValue: (configTarget, value) => {
      setPluginConfigValue(
        configTarget,
        SPIDER_FETCH_PLUGIN_ID,
        "webFetch",
        "timeoutSeconds",
        value,
      );
    },
    applySelectionConfig: (config) => enablePluginInConfig(config, SPIDER_FETCH_PLUGIN_ID).config,
  };
}

export function nativeBundledWebSearchProvidersForPlugin(
  pluginId: string,
): PluginWebSearchProviderEntry[] {
  if (pluginId !== SEARXNG_PLUGIN_ID) {
    return [];
  }
  return [{ pluginId, ...searxngProvider() }];
}

export function nativeBundledWebFetchProvidersForPlugin(
  pluginId: string,
): PluginWebFetchProviderEntry[] {
  if (pluginId !== SPIDER_FETCH_PLUGIN_ID) {
    return [];
  }
  return [{ pluginId, ...spiderFetchProvider() }];
}
