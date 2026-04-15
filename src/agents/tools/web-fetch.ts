import { Type } from "@sinclair/typebox";
import type { CrawClawConfig } from "../../config/config.js";
import { SsrFBlockedError } from "../../infra/net/ssrf.js";
import type { RuntimeWebFetchMetadata } from "../../secrets/runtime-web-tools.types.js";
import {
  resolveWebFetchConfig,
  resolveWebFetchDefinition,
  resolveWebFetchEnabled,
} from "../../web-fetch/runtime.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import {
  normalizeRequestedDetail,
  normalizeRequestedExtractVariant,
  normalizeRequestedOutput,
  normalizeRequestedRender,
  normalizeRequestedWaitUntil,
  resolveInternalExtractMode,
  WEB_FETCH_DETAIL_LEVELS,
  WEB_FETCH_EXTRACT_VARIANTS,
  WEB_FETCH_OUTPUT_MODES,
  WEB_FETCH_RENDER_MODES,
  WEB_FETCH_WAIT_UNTIL_MODES,
  type WebFetchDetailLevel,
  type WebFetchExtractVariant,
  type WebFetchOutputMode,
  type WebFetchRenderMode,
  type WebFetchWaitUntilMode,
} from "./web-fetch-detail.js";
import {
  extractBasicHtmlContent,
  extractReadableContent,
  markdownToText,
  type ExtractMode,
} from "./web-fetch-utils.js";
import {
  formatWebFetchErrorDetail,
  logWebFetchMarkdownTokens,
  maybeFetchProviderWebFetchPayload,
  normalizeContentType,
  resolveFetchMaxCharsCap,
  resolveFetchMaxResponseBytes,
  resolveFetchReadabilityEnabled,
  resolveMaxChars,
  resolveMaxRedirects,
  sanitizeOptionalString,
  standardizeWebFetchPayload,
  type WebFetchRuntimeParams,
} from "./web-fetch-runtime-helpers.js";
import { fetchWithWebToolsNetworkGuard } from "./web-guarded-fetch.js";
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  writeCache,
} from "./web-shared.js";

export { extractReadableContent } from "./web-fetch-utils.js";

const EXTRACT_MODES = ["markdown", "text"] as const;

const DEFAULT_FETCH_MAX_CHARS = 50_000;
const DEFAULT_FETCH_MAX_REDIRECTS = 3;
const DEFAULT_ERROR_MAX_BYTES = 64_000;
const DEFAULT_FETCH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const DEFAULT_WEB_FETCH_SSRF_POLICY = {
  dangerouslyAllowPrivateNetwork: true,
  allowRfc2544BenchmarkRange: true,
} as const;

const FETCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

const WebFetchSchema = Type.Object({
  url: Type.String({ description: "HTTP or HTTPS URL to fetch." }),
  detail: Type.Optional(
    stringEnum(WEB_FETCH_DETAIL_LEVELS, {
      description: 'Return budget profile ("brief", "standard", or "full").',
      default: "brief",
    }),
  ),
  output: Type.Optional(
    stringEnum(WEB_FETCH_OUTPUT_MODES, {
      description: 'Preferred output shape ("markdown", "text", "html", or "structured").',
      default: "markdown",
    }),
  ),
  render: Type.Optional(
    stringEnum(WEB_FETCH_RENDER_MODES, {
      description:
        'Rendering hint for provider-backed fetchers ("auto", "never", "stealth", or "dynamic").',
      default: "auto",
    }),
  ),
  extractMode: Type.Optional(
    stringEnum(EXTRACT_MODES, {
      description: 'Legacy alias for output ("markdown" or "text").',
      default: "markdown",
    }),
  ),
  extract: Type.Optional(
    stringEnum(WEB_FETCH_EXTRACT_VARIANTS, {
      description: 'Extraction focus ("readable", "raw", "links", or "metadata").',
      default: "readable",
    }),
  ),
  mainContentOnly: Type.Optional(
    Type.Boolean({
      description: "Prefer the page's main readable content when available.",
      default: true,
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      description: "Optional per-request timeout in milliseconds.",
      minimum: 100,
    }),
  ),
  waitUntil: Type.Optional(
    stringEnum(WEB_FETCH_WAIT_UNTIL_MODES, {
      description:
        'Optional provider-backed wait strategy ("domcontentloaded", "load", or "networkidle").',
    }),
  ),
  waitFor: Type.Optional(
    Type.String({
      description: "Optional selector or readiness hint for provider-backed fetchers.",
    }),
  ),
  sessionId: Type.Optional(
    Type.String({
      description: "Optional sticky session id for provider-backed fetchers.",
    }),
  ),
  maxChars: Type.Optional(
    Type.Number({
      description: "Maximum characters to return (truncates when exceeded).",
      minimum: 100,
    }),
  ),
});
async function runWebFetch(params: WebFetchRuntimeParams): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    `fetch:${params.url}:${params.detail}:${params.output}:${params.render}:${params.extract}:${params.mainContentOnly ? "main" : "all"}:${params.extractMode}:${params.maxChars}`,
  );
  const cached = readCache(FETCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(params.url);
  } catch {
    throw new Error("Invalid URL: must be http or https");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Invalid URL: must be http or https");
  }

  const start = Date.now();
  let res: Response;
  let release: (() => Promise<void>) | null = null;
  let finalUrl = params.url;
  try {
    const result = await fetchWithWebToolsNetworkGuard({
      url: params.url,
      maxRedirects: params.maxRedirects,
      timeoutSeconds: params.timeoutSeconds,
      policy: DEFAULT_WEB_FETCH_SSRF_POLICY,
      init: {
        headers: {
          Accept: "text/markdown, text/html;q=0.9, */*;q=0.1",
          "User-Agent": params.userAgent,
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
    });
    res = result.response;
    finalUrl = result.finalUrl;
    release = result.release;

    const primaryProviderPayload = await maybeFetchProviderWebFetchPayload({
      ...params,
      urlToFetch: finalUrl,
      cacheKey,
      tookMs: Date.now() - start,
      usedFallback: false,
      ignoreErrorPayloads: true,
      cache: FETCH_CACHE,
    });
    if (primaryProviderPayload) {
      return primaryProviderPayload;
    }

    // Cloudflare Markdown for Agents — log token budget hint when present
    const markdownTokens = res.headers.get("x-markdown-tokens");
    if (markdownTokens) {
      logWebFetchMarkdownTokens(finalUrl, markdownTokens);
    }
  } catch (error) {
    if (error instanceof SsrFBlockedError) {
      throw error;
    }
    const payload = await maybeFetchProviderWebFetchPayload({
      ...params,
      urlToFetch: finalUrl,
      cacheKey,
      tookMs: Date.now() - start,
      usedFallback: true,
      cache: FETCH_CACHE,
    });
    if (payload) {
      return payload;
    }
    throw error;
  }

  try {
    if (!res.ok) {
      const payload = await maybeFetchProviderWebFetchPayload({
        ...params,
        urlToFetch: params.url,
        cacheKey,
        tookMs: Date.now() - start,
        usedFallback: true,
        cache: FETCH_CACHE,
      });
      if (payload) {
        return payload;
      }
      const rawDetailResult = await readResponseText(res, { maxBytes: DEFAULT_ERROR_MAX_BYTES });
      const rawDetail = rawDetailResult.text;
      const detail = formatWebFetchErrorDetail({
        detail: rawDetail,
        contentType: res.headers.get("content-type"),
      });
      const wrappedDetail = standardizeWebFetchPayload({
        fetcher: "http",
        usedFallback: false,
        rendered: false,
        blockedDetected: false,
        url: params.url,
        finalUrl,
        status: res.status,
        detail: "brief",
        output: "text",
        render: params.render,
        extractMode: "text",
        extractor: "error",
        content: detail || res.statusText,
        plainText: detail || res.statusText,
        fetchedAt: new Date().toISOString(),
        tookMs: Date.now() - start,
        maxChars: 4_000,
      });
      throw new Error(`Web fetch failed (${res.status}): ${String(wrappedDetail.text ?? "")}`);
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const normalizedContentType = normalizeContentType(contentType) ?? "application/octet-stream";
    const bodyResult = await readResponseText(res, { maxBytes: params.maxResponseBytes });
    const body = bodyResult.text;
    const responseTruncatedWarning = bodyResult.truncated
      ? `Response body truncated after ${params.maxResponseBytes} bytes.`
      : undefined;

    let title: string | undefined;
    let extractor = "raw";
    let text = body;
    let outputContent = body;
    if (contentType.includes("text/markdown")) {
      // Cloudflare Markdown for Agents: server returned pre-rendered markdown
      extractor = "cf-markdown";
      if (params.extractMode === "text") {
        text = markdownToText(body);
      }
      outputContent = params.output === "html" ? body : text;
    } else if (contentType.includes("text/html")) {
      if (params.readabilityEnabled) {
        const readable = await extractReadableContent({
          html: body,
          url: finalUrl,
          extractMode: params.extractMode,
        });
        if (readable?.text) {
          text = readable.text;
          title = readable.title;
          extractor = "readability";
          outputContent = params.output === "html" ? body : readable.text;
        } else {
          let payload: Record<string, unknown> | null = null;
          try {
            payload = await maybeFetchProviderWebFetchPayload({
              ...params,
              urlToFetch: finalUrl,
              cacheKey,
              tookMs: Date.now() - start,
              usedFallback: true,
              cache: FETCH_CACHE,
            });
          } catch {
            payload = null;
          }
          if (payload) {
            return payload;
          }
          const basic = await extractBasicHtmlContent({
            html: body,
            extractMode: params.extractMode,
          });
          if (basic?.text) {
            text = basic.text;
            title = basic.title;
            extractor = "raw-html";
            outputContent = params.output === "html" ? body : basic.text;
          } else {
            const providerLabel = params.providerFallback?.provider.label ?? "provider fallback";
            throw new Error(
              `Web fetch extraction failed: Readability, ${providerLabel}, and basic HTML cleanup returned no content.`,
            );
          }
        }
      } else {
        const payload = await maybeFetchProviderWebFetchPayload({
          ...params,
          urlToFetch: finalUrl,
          cacheKey,
          tookMs: Date.now() - start,
          usedFallback: true,
          cache: FETCH_CACHE,
        });
        if (payload) {
          return payload;
        }
        throw new Error(
          "Web fetch extraction failed: Readability disabled and no fetch provider is available.",
        );
      }
    } else if (contentType.includes("application/json")) {
      try {
        text = JSON.stringify(JSON.parse(body), null, 2);
        extractor = "json";
        outputContent = text;
      } catch {
        text = body;
        extractor = "raw";
        outputContent = body;
      }
    } else {
      outputContent = text;
    }

    const payload = standardizeWebFetchPayload({
      fetcher: "http",
      usedFallback: false,
      rendered: false,
      blockedDetected: false,
      url: params.url,
      finalUrl,
      status: res.status,
      contentType: normalizedContentType,
      title,
      warning: responseTruncatedWarning,
      detail: params.detail,
      output: params.output,
      render: params.render,
      extractMode: params.extractMode,
      extractor,
      content: outputContent,
      plainText: text,
      fetchedAt: new Date().toISOString(),
      tookMs: Date.now() - start,
      maxChars: params.maxChars,
    });
    writeCache(FETCH_CACHE, cacheKey, payload, params.cacheTtlMs);
    return payload;
  } finally {
    if (release) {
      await release();
    }
  }
}

export function createWebFetchTool(options?: {
  config?: CrawClawConfig;
  sandboxed?: boolean;
  runtimeWebFetch?: RuntimeWebFetchMetadata;
}): AnyAgentTool | null {
  const fetch = resolveWebFetchConfig(options?.config);
  if (!resolveWebFetchEnabled({ fetch, sandboxed: options?.sandboxed })) {
    return null;
  }
  const readabilityEnabled = resolveFetchReadabilityEnabled(fetch);
  const providerFallback = resolveWebFetchDefinition({
    config: options?.config,
    sandboxed: options?.sandboxed,
    runtimeWebFetch: options?.runtimeWebFetch,
    preferRuntimeProviders: true,
  });
  const userAgent =
    (fetch && "userAgent" in fetch && typeof fetch.userAgent === "string" && fetch.userAgent) ||
    DEFAULT_FETCH_USER_AGENT;
  const maxResponseBytes = resolveFetchMaxResponseBytes(fetch);
  return {
    label: "Web Fetch",
    name: "web_fetch",
    description:
      "Fetch a URL into a context-budgeted page snapshot. Defaults to brief readable output while supporting standard/full detail and provider-backed rendering hints.",
    parameters: WebFetchSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const url = readStringParam(params, "url", { required: true });
      const output = normalizeRequestedOutput({
        output: readStringParam(params, "output"),
        extractMode: readStringParam(params, "extractMode"),
      });
      const extractMode = resolveInternalExtractMode(output);
      const detail = normalizeRequestedDetail(readStringParam(params, "detail"));
      const render = normalizeRequestedRender(readStringParam(params, "render"));
      const extract = normalizeRequestedExtractVariant(readStringParam(params, "extract"));
      const mainContentOnly = params.mainContentOnly !== false;
      const waitUntil = normalizeRequestedWaitUntil(readStringParam(params, "waitUntil"));
      const waitFor = sanitizeOptionalString(readStringParam(params, "waitFor"));
      const sessionId = sanitizeOptionalString(readStringParam(params, "sessionId"));
      const maxChars = readNumberParam(params, "maxChars", { integer: true });
      const timeoutMs = readNumberParam(params, "timeoutMs", { integer: true });
      const maxCharsCap = resolveFetchMaxCharsCap(fetch);
      const result = await runWebFetch({
        url,
        detail,
        output,
        render,
        extract,
        mainContentOnly,
        ...(waitUntil ? { waitUntil } : {}),
        ...(waitFor ? { waitFor } : {}),
        ...(sessionId ? { sessionId } : {}),
        extractMode,
        maxChars: resolveMaxChars(
          maxChars ?? fetch?.maxChars,
          DEFAULT_FETCH_MAX_CHARS,
          maxCharsCap,
        ),
        maxResponseBytes,
        maxRedirects: resolveMaxRedirects(fetch?.maxRedirects, DEFAULT_FETCH_MAX_REDIRECTS),
        timeoutSeconds:
          typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
            ? Math.max(1, Math.ceil(timeoutMs / 1000))
            : resolveTimeoutSeconds(fetch?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
        cacheTtlMs: resolveCacheTtlMs(fetch?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
        userAgent,
        readabilityEnabled,
        providerFallback,
      });
      return jsonResult(result);
    },
  };
}
