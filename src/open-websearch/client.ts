import type { CrawClawConfig } from "../plugin-sdk/config-runtime.js";
import {
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_SEARCH_COUNT,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveSearchCount,
  resolveSiteName,
  resolveTimeoutSeconds,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  writeCache,
} from "../plugin-sdk/provider-web-search.js";
import { assertHttpUrlTargetsPrivateNetwork, type LookupFn } from "../plugin-sdk/ssrf-runtime.js";
import { resolveOpenWebSearchDefaultEngines } from "./config.js";
import { ensureManagedOpenWebSearchDaemon } from "./daemon.js";

const DEFAULT_TIMEOUT_SECONDS = 20;
const MAX_RESPONSE_BYTES = 1_000_000;

const OPEN_WEBSEARCH_CACHE = new Map<
  string,
  { value: Record<string, unknown>; insertedAt: number; expiresAt: number }
>();

type OpenWebSearchResult = {
  url: string;
  title: string;
  description?: string;
  snippet?: string;
  content?: string;
  engine?: string;
  source?: string;
};

type OpenWebSearchResponse = {
  results?: unknown;
  data?: {
    results?: unknown;
  };
};

function normalizeResult(value: unknown): OpenWebSearchResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.url !== "string" || typeof candidate.title !== "string") {
    return null;
  }
  return {
    url: candidate.url,
    title: candidate.title,
    description: typeof candidate.description === "string" ? candidate.description : undefined,
    snippet: typeof candidate.snippet === "string" ? candidate.snippet : undefined,
    content: typeof candidate.content === "string" ? candidate.content : undefined,
    engine: typeof candidate.engine === "string" ? candidate.engine : undefined,
    source: typeof candidate.source === "string" ? candidate.source : undefined,
  };
}

function normalizeResults(value: unknown, count: number): OpenWebSearchResult[] {
  let rawResults: unknown[] = [];
  if (Array.isArray(value)) {
    rawResults = value;
  } else if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as OpenWebSearchResponse).results)
  ) {
    rawResults = (value as OpenWebSearchResponse).results as unknown[];
  } else if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as OpenWebSearchResponse).data?.results)
  ) {
    rawResults = (value as OpenWebSearchResponse).data?.results as unknown[];
  }
  const results: OpenWebSearchResult[] = [];
  for (const entry of rawResults) {
    const normalized = normalizeResult(entry);
    if (!normalized) {
      continue;
    }
    results.push(normalized);
    if (results.length >= count) {
      break;
    }
  }
  return results;
}

function buildSearchUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.endsWith("/") ? `${url.pathname}search` : `${url.pathname}/search`;
  url.search = "";
  return url.toString();
}

async function validateBaseUrl(baseUrl: string, lookupFn?: LookupFn): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Open-WebSearch base URL must be a valid http:// or https:// URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Open-WebSearch base URL must use http:// or https://.");
  }

  if (parsed.protocol === "http:") {
    await assertHttpUrlTargetsPrivateNetwork(parsed.toString(), {
      allowPrivateNetwork: true,
      lookupFn,
      errorMessage:
        "Open-WebSearch HTTP base URL must target a trusted private or loopback host. Use https:// for public hosts.",
    });
  }
}

export async function runOpenWebSearch(params: {
  config?: CrawClawConfig;
  query: string;
  count?: number;
  engines?: string[];
  baseUrl?: string;
  timeoutSeconds?: number;
  cacheTtlMinutes?: number;
}): Promise<Record<string, unknown>> {
  const count = resolveSearchCount(params.count, DEFAULT_SEARCH_COUNT);
  const baseUrl =
    params.baseUrl ??
    (await ensureManagedOpenWebSearchDaemon({
      config: params.config,
    }));
  const defaultEngines = resolveOpenWebSearchDefaultEngines(params.config);
  const engines = params.engines?.length ? params.engines : defaultEngines;
  const timeoutSeconds = resolveTimeoutSeconds(params.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS);
  const cacheTtlMs = resolveCacheTtlMs(params.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES);

  if (!baseUrl) {
    throw new Error(
      "Open-WebSearch base URL is not configured. Set OPEN_WEBSEARCH_BASE_URL or configure plugins.entries.open-websearch.config.webSearch.baseUrl.",
    );
  }
  await validateBaseUrl(baseUrl);

  const cacheKey = normalizeCacheKey(
    JSON.stringify({
      provider: "open-websearch",
      query: params.query,
      count,
      engines: engines ?? [],
      baseUrl,
    }),
  );
  const cached = readCache(OPEN_WEBSEARCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const url = buildSearchUrl(baseUrl);
  const startedAt = Date.now();
  const results = await withTrustedWebSearchEndpoint(
    {
      url,
      timeoutSeconds,
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: params.query,
          limit: count,
          ...(engines?.length ? { engines } : {}),
        }),
      },
    },
    async (response) => {
      if (!response.ok) {
        const detail = (await readResponseText(response, { maxBytes: 64_000 })).text;
        throw new Error(
          `Open-WebSearch search error (${response.status}): ${detail || response.statusText}`,
        );
      }
      const body = await readResponseText(response, { maxBytes: MAX_RESPONSE_BYTES });
      if (body.truncated) {
        throw new Error("Open-WebSearch response too large.");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.text);
      } catch {
        throw new Error("Open-WebSearch returned invalid JSON.");
      }
      return normalizeResults(parsed, count);
    },
  );

  const payload = {
    query: params.query,
    provider: "open-websearch",
    count: results.length,
    tookMs: Date.now() - startedAt,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "open-websearch",
      wrapped: true,
    },
    results: results.map((result) => ({
      title: wrapWebContent(result.title, "web_search"),
      url: result.url,
      snippet: result.snippet
        ? wrapWebContent(result.snippet, "web_search")
        : result.description
          ? wrapWebContent(result.description, "web_search")
          : result.content
            ? wrapWebContent(result.content, "web_search")
            : "",
      siteName: resolveSiteName(result.url) || undefined,
      engine: result.engine,
      source: result.source,
    })),
  } satisfies Record<string, unknown>;

  writeCache(OPEN_WEBSEARCH_CACHE, cacheKey, payload, cacheTtlMs);
  return payload;
}

export const __testing = {
  buildSearchUrl,
  normalizeResult,
  normalizeResults,
  validateBaseUrl,
  OPEN_WEBSEARCH_CACHE,
};
