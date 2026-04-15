import type { WebFetchProviderPlugin } from "crawclaw/plugin-sdk/provider-web-fetch";
import {
  enablePluginInConfig,
  readNumberParam,
  readStringParam,
} from "crawclaw/plugin-sdk/provider-web-fetch";
import {
  ScraplingFetchClient,
  ScraplingFetchError,
  ScraplingFetchUnavailableError,
} from "./client.js";
import type {
  ScraplingFetchDetail,
  ScraplingFetchExtract,
  ScraplingFetchOutput,
  ScraplingFetchRequest,
  ScraplingFetchRender,
  ScraplingFetchWaitUntil,
} from "./client.js";
import {
  resolveScraplingFetchPluginConfig,
  SCRAPLING_FETCH_PLUGIN_ID,
  SCRAPLING_FETCH_PROVIDER_ID,
} from "./config.js";

function readOptionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const raw = args[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function buildFailurePayload(params: {
  code: string;
  message: string;
  details: Record<string, unknown>;
  request: Record<string, unknown>;
  status: number;
}): Record<string, unknown> {
  return {
    provider: SCRAPLING_FETCH_PROVIDER_ID,
    fetcher: "scrapling-sidecar",
    status: params.status,
    code: params.code,
    extractor: "scrapling-error",
    externalContent: {
      untrusted: true,
      source: "web_fetch",
      wrapped: true,
      provider: SCRAPLING_FETCH_PROVIDER_ID,
    },
    text: `Scrapling error (${params.code}): ${params.message}`,
    warning: params.message,
    request: params.request,
    error: {
      code: params.code,
      message: params.message,
      details: params.details,
    },
    fetchedAt: new Date().toISOString(),
    tookMs: 0,
    truncated: false,
    length: params.message.length,
    rawLength: params.message.length,
    wrappedLength: params.message.length,
  };
}

export function createScraplingWebFetchProvider(): WebFetchProviderPlugin {
  return {
    id: SCRAPLING_FETCH_PROVIDER_ID,
    label: "Scrapling",
    hint: "Fetch pages through a managed local Scrapling Python/HTTP sidecar.",
    requiresCredential: false,
    envVars: [],
    placeholder: "Select explicitly to use the managed Scrapling sidecar",
    signupUrl: "https://github.com/D4Vinci/Scrapling",
    docsUrl: "https://scrapling.readthedocs.io/",
    autoDetectOrder: 0,
    credentialPath: `plugins.entries.${SCRAPLING_FETCH_PLUGIN_ID}.config.webFetch.apiKey`,
    inactiveSecretPaths: [
      `plugins.entries.${SCRAPLING_FETCH_PLUGIN_ID}.config.webFetch.apiKey`,
      "tools.web.fetch.scrapling.apiKey",
    ],
    getCredentialValue: (fetchConfig) => {
      if (!fetchConfig || typeof fetchConfig !== "object" || Array.isArray(fetchConfig)) {
        return undefined;
      }
      const legacy = (fetchConfig as Record<string, unknown>).scrapling;
      if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) {
        return undefined;
      }
      return (legacy as { apiKey?: unknown }).apiKey;
    },
    setCredentialValue: (fetchConfigTarget, value) => {
      const existing = fetchConfigTarget.scrapling;
      const scrapling =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {};
      scrapling.apiKey = value;
      fetchConfigTarget.scrapling = scrapling;
    },
    getConfiguredCredentialValue: (config) =>
      (
        config?.plugins?.entries?.[SCRAPLING_FETCH_PLUGIN_ID]?.config as
          | { webFetch?: { apiKey?: unknown } }
          | undefined
      )?.webFetch?.apiKey,
    setConfiguredCredentialValue: (configTarget, value) => {
      const plugins = (configTarget.plugins ??= {});
      const entries = (plugins.entries ??= {});
      const pluginEntry = (entries[SCRAPLING_FETCH_PLUGIN_ID] ??= {});
      const pluginConfig =
        pluginEntry.config &&
        typeof pluginEntry.config === "object" &&
        !Array.isArray(pluginEntry.config)
          ? (pluginEntry.config as Record<string, unknown>)
          : ((pluginEntry.config = {}), pluginEntry.config as Record<string, unknown>);
      const webFetch =
        pluginConfig.webFetch &&
        typeof pluginConfig.webFetch === "object" &&
        !Array.isArray(pluginConfig.webFetch)
          ? (pluginConfig.webFetch as Record<string, unknown>)
          : ((pluginConfig.webFetch = {}), pluginConfig.webFetch as Record<string, unknown>);
      webFetch.apiKey = value;
    },
    applySelectionConfig: (config) =>
      enablePluginInConfig(config, SCRAPLING_FETCH_PLUGIN_ID).config,
    createTool: ({ config }) => ({
      description:
        "Fetch a page using the managed Scrapling Python/HTTP sidecar. This is the default bundled web_fetch provider.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: { type: "string", description: "Absolute URL to fetch." },
          output: {
            type: "string",
            enum: ["markdown", "text", "html", "structured"],
            description: "Preferred output shape.",
          },
          extractMode: {
            type: "string",
            enum: ["markdown", "text", "html"],
            description: "Legacy alias for output.",
          },
          detail: {
            type: "string",
            enum: ["brief", "standard", "full"],
          },
          render: {
            type: "string",
            enum: ["auto", "never", "stealth", "dynamic"],
          },
          extract: {
            type: "string",
            enum: ["readable", "raw", "links", "metadata"],
          },
          maxChars: { type: "number" },
          timeoutSeconds: { type: "number" },
          mainContentOnly: { type: "boolean" },
          waitUntil: {
            type: "string",
            enum: ["domcontentloaded", "load", "networkidle"],
          },
          waitFor: { type: "string" },
          sessionId: { type: "string" },
        },
      },
      execute: async (args) => {
        const resolvedConfig = resolveScraplingFetchPluginConfig(config);
        const client = new ScraplingFetchClient(resolvedConfig);
        const url = readStringParam(args, "url", { required: true })!;
        const outputRaw = readStringParam(args, "output");
        const extractModeRaw = readStringParam(args, "extractMode");
        const detailRaw = readStringParam(args, "detail");
        const renderRaw = readStringParam(args, "render");
        const extractRaw = readStringParam(args, "extract");
        const waitUntilRaw = readStringParam(args, "waitUntil");
        const waitForRaw = readStringParam(args, "waitFor");
        const sessionIdRaw = readStringParam(args, "sessionId");
        const output =
          outputRaw === "text" ||
          outputRaw === "html" ||
          outputRaw === "structured" ||
          outputRaw === "markdown"
            ? outputRaw
            : undefined;
        const extractMode = extractModeRaw === "text" ? "text" : "markdown";
        const maxChars = readNumberParam(args, "maxChars");
        const timeoutSeconds = readNumberParam(args, "timeoutSeconds");

        const request: ScraplingFetchRequest = {
          url,
          ...(output ? { output: output as ScraplingFetchOutput } : {}),
          extractMode,
          ...(detailRaw ? { detail: detailRaw as ScraplingFetchDetail } : {}),
          ...(renderRaw ? { render: renderRaw as ScraplingFetchRender } : {}),
          ...(extractRaw
            ? {
                extract: extractRaw as ScraplingFetchExtract,
              }
            : {}),
          ...(typeof maxChars === "number" ? { maxChars } : {}),
          ...(typeof timeoutSeconds === "number" ? { timeoutSeconds } : {}),
          mainContentOnly:
            readOptionalBoolean(args, "mainContentOnly") ?? resolvedConfig.webFetch.onlyMainContent,
          ...(waitUntilRaw
            ? {
                waitUntil: waitUntilRaw as ScraplingFetchWaitUntil,
              }
            : {}),
          ...(waitForRaw ? { waitFor: waitForRaw } : {}),
          ...(sessionIdRaw ? { sessionId: sessionIdRaw } : {}),
        };

        try {
          return await client.fetchPage(request);
        } catch (error) {
          if (
            error instanceof ScraplingFetchUnavailableError ||
            error instanceof ScraplingFetchError
          ) {
            return buildFailurePayload({
              code: error.code,
              message: error.message,
              details: error.details,
              request,
              status: error instanceof ScraplingFetchUnavailableError ? 503 : 500,
            });
          }
          throw error;
        }
      },
    }),
  };
}
