import { readNumberParam, readStringArrayParam, readStringParam } from "../agents/tools/common.js";
import type { CrawClawConfig } from "../config/config.js";
import { callGateway } from "../gateway/call.js";
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
    createTool: (ctx) => ({
      description: "Search the web using CrawClaw's Rust-owned SearXNG provider.",
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
            description: "Optional SearXNG engine ids.",
          },
          categories: {
            type: "array",
            items: { type: "string" },
            description: "Optional SearXNG categories.",
          },
          language: { type: "string" },
          safeSearch: { type: "string", enum: ["off", "moderate", "strict"] },
          timeRange: { type: "string", enum: ["day", "week", "month", "year"] },
          baseUrl: {
            type: "string",
            description: "Optional explicit SearXNG endpoint override.",
          },
          timeoutSeconds: { type: "number" },
        },
      },
      execute: async (args) =>
        await callGateway({
          method: "tools.invoke",
          params: {
            tool: "web_search",
            input: {
              query: readStringParam(args, "query", { required: true }),
              count: readNumberParam(args, "count", { integer: true }),
              engines: readStringArrayParam(args, "engines"),
              categories: readStringArrayParam(args, "categories"),
              language: readStringParam(args, "language"),
              safeSearch: readStringParam(args, "safeSearch"),
              timeRange: readStringParam(args, "timeRange"),
              baseUrl: readStringParam(args, "baseUrl"),
              timeoutSeconds: readNumberParam(args, "timeoutSeconds", { integer: true }),
              pluginConfig: pluginConfig(ctx.config, SEARXNG_PLUGIN_ID),
            },
          },
        }),
    }),
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
    createTool: (ctx) => ({
      description: "Fetch a page using CrawClaw's Rust-native Spider provider.",
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
        await callGateway({
          method: "tools.invoke",
          params: {
            tool: "web_fetch",
            input: {
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
              pluginConfig: pluginConfig(ctx.config, SPIDER_FETCH_PLUGIN_ID),
            },
          },
        }),
    }),
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
