import { runCrawClawRuntimeTool } from "../agents/runtime-tools/native.js";
import { readNumberParam, readStringArrayParam, readStringParam } from "../agents/tools/common.js";
import type { CrawClawConfig } from "../config/config.js";
import { enablePluginInConfig } from "./enable.js";
import type {
  PluginWebFetchProviderEntry,
  PluginWebSearchProviderEntry,
  WebFetchProviderPlugin,
  WebSearchProviderPlugin,
} from "./types.js";

const OPEN_WEBSEARCH_PLUGIN_ID = "open-websearch";
const OPEN_WEBSEARCH_PROVIDER_ID = "open-websearch";
const SCRAPLING_FETCH_PLUGIN_ID = "scrapling-fetch";
const SCRAPLING_FETCH_PROVIDER_ID = "scrapling";

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

function openWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: OPEN_WEBSEARCH_PROVIDER_ID,
    label: "Open-WebSearch",
    hint: "Use the bundled managed open-websearch daemon for keyless multi-engine web search",
    onboardingScopes: ["text-inference"],
    requiresCredential: false,
    credentialLabel: "Open-WebSearch base URL override",
    envVars: ["OPEN_WEBSEARCH_BASE_URL"],
    placeholder: "http://127.0.0.1:3210",
    signupUrl: "https://github.com/Aas-ee/open-webSearch",
    docsUrl: "https://docs.crawclaw.ai/tools/open-websearch",
    autoDetectOrder: 5,
    credentialPath: "plugins.entries.open-websearch.config.webSearch.baseUrl",
    inactiveSecretPaths: ["plugins.entries.open-websearch.config.webSearch.baseUrl"],
    getCredentialValue: (searchConfig) => record(searchConfig)?.[OPEN_WEBSEARCH_PROVIDER_ID],
    setCredentialValue: (searchConfigTarget, value) => {
      searchConfigTarget[OPEN_WEBSEARCH_PROVIDER_ID] = value;
    },
    getConfiguredCredentialValue: (config) =>
      scopedConfig(config, OPEN_WEBSEARCH_PLUGIN_ID, "webSearch")?.baseUrl,
    setConfiguredCredentialValue: (configTarget, value) => {
      setPluginConfigValue(configTarget, OPEN_WEBSEARCH_PLUGIN_ID, "webSearch", "baseUrl", value);
    },
    applySelectionConfig: (config) => enablePluginInConfig(config, OPEN_WEBSEARCH_PLUGIN_ID).config,
    createTool: (ctx) => ({
      description: "Search the web using CrawClaw's Rust-native open-websearch provider.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", description: "Search query string." },
          count: {
            type: "number",
            description: "Number of results to return.",
            minimum: 1,
            maximum: 10,
          },
          engines: {
            type: "array",
            items: { type: "string" },
            description: "Optional open-websearch engine ids.",
          },
          timeoutSeconds: { type: "number" },
        },
      },
      execute: async (args) =>
        await runCrawClawRuntimeTool("web_search", {
          query: readStringParam(args, "query", { required: true }),
          count: readNumberParam(args, "count", { integer: true }),
          engines: readStringArrayParam(args, "engines"),
          timeoutSeconds: readNumberParam(args, "timeoutSeconds", { integer: true }),
          pluginConfig: pluginConfig(ctx.config, OPEN_WEBSEARCH_PLUGIN_ID),
        }),
    }),
  };
}

function scraplingFetchProvider(): WebFetchProviderPlugin {
  return {
    id: SCRAPLING_FETCH_PROVIDER_ID,
    label: "Scrapling",
    hint: "Fetch pages through CrawClaw's Rust-native Scrapling provider.",
    requiresCredential: false,
    envVars: [],
    placeholder: "Select explicitly to use the managed Scrapling sidecar",
    signupUrl: "https://github.com/D4Vinci/Scrapling",
    docsUrl: "https://scrapling.readthedocs.io/",
    autoDetectOrder: 0,
    credentialPath: "plugins.entries.scrapling-fetch.config.webFetch.apiKey",
    inactiveSecretPaths: [
      "plugins.entries.scrapling-fetch.config.webFetch.apiKey",
      "tools.web.fetch.scrapling.apiKey",
    ],
    getCredentialValue: (fetchConfig) => record(record(fetchConfig)?.scrapling)?.apiKey,
    setCredentialValue: (fetchConfigTarget, value) => {
      const current = record(fetchConfigTarget.scrapling) ?? {};
      current.apiKey = value;
      fetchConfigTarget.scrapling = current;
    },
    getConfiguredCredentialValue: (config) =>
      scopedConfig(config, SCRAPLING_FETCH_PLUGIN_ID, "webFetch")?.apiKey,
    setConfiguredCredentialValue: (configTarget, value) => {
      setPluginConfigValue(configTarget, SCRAPLING_FETCH_PLUGIN_ID, "webFetch", "apiKey", value);
    },
    applySelectionConfig: (config) =>
      enablePluginInConfig(config, SCRAPLING_FETCH_PLUGIN_ID).config,
    createTool: (ctx) => ({
      description: "Fetch a page using CrawClaw's Rust-native Scrapling provider.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: { type: "string", description: "Absolute URL to fetch." },
          output: {
            type: "string",
            enum: ["markdown", "text", "html", "structured"],
          },
          extractMode: { type: "string", enum: ["markdown", "text", "html"] },
          detail: { type: "string", enum: ["brief", "standard", "full"] },
          render: { type: "string", enum: ["auto", "never", "stealth", "dynamic"] },
          extract: { type: "string", enum: ["readable", "raw", "links", "metadata"] },
          maxChars: { type: "number" },
          timeoutSeconds: { type: "number" },
          mainContentOnly: { type: "boolean" },
          waitUntil: { type: "string", enum: ["domcontentloaded", "load", "networkidle"] },
          waitFor: { type: "string" },
          sessionId: { type: "string" },
        },
      },
      execute: async (args) =>
        await runCrawClawRuntimeTool("web_fetch", {
          url: readStringParam(args, "url", { required: true }),
          output: readStringParam(args, "output"),
          extractMode: readStringParam(args, "extractMode"),
          detail: readStringParam(args, "detail"),
          render: readStringParam(args, "render"),
          extract: readStringParam(args, "extract"),
          maxChars: readNumberParam(args, "maxChars", { integer: true }),
          timeoutSeconds: readNumberParam(args, "timeoutSeconds", { integer: true }),
          mainContentOnly:
            typeof args.mainContentOnly === "boolean" ? args.mainContentOnly : undefined,
          waitUntil: readStringParam(args, "waitUntil"),
          waitFor: readStringParam(args, "waitFor"),
          sessionId: readStringParam(args, "sessionId"),
          pluginConfig: pluginConfig(ctx.config, SCRAPLING_FETCH_PLUGIN_ID),
        }),
    }),
  };
}

export function nativeBundledWebSearchProvidersForPlugin(
  pluginId: string,
): PluginWebSearchProviderEntry[] {
  if (pluginId !== OPEN_WEBSEARCH_PLUGIN_ID) {
    return [];
  }
  return [{ pluginId, ...openWebSearchProvider() }];
}

export function nativeBundledWebFetchProvidersForPlugin(
  pluginId: string,
): PluginWebFetchProviderEntry[] {
  if (pluginId !== SCRAPLING_FETCH_PLUGIN_ID) {
    return [];
  }
  return [{ pluginId, ...scraplingFetchProvider() }];
}
