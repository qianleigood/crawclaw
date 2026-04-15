import { logDebug } from "../../logger.js";
import { wrapExternalContent, wrapWebContent } from "../../security/external-content.js";
import type { WebFetchConfig } from "../../web-fetch/runtime.js";
import {
  buildWebFetchContentShape,
  resolvePlainTextContent,
  type WebFetchDetailLevel,
  type WebFetchExtractVariant,
  type WebFetchOutputMode,
  type WebFetchRenderMode,
  type WebFetchWaitUntilMode,
} from "./web-fetch-detail.js";
import {
  htmlToMarkdown,
  markdownToText,
  truncateText,
  type ExtractMode,
} from "./web-fetch-utils.js";
import {
  type CacheEntry,
  writeCache,
} from "./web-shared.js";

const DEFAULT_FETCH_MAX_CHARS = 50_000;
const DEFAULT_FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_MAX_RESPONSE_BYTES_MIN = 32_000;
const FETCH_MAX_RESPONSE_BYTES_MAX = 10_000_000;
const DEFAULT_ERROR_MAX_CHARS = 4_000;

const WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD = wrapWebContent("", "web_fetch").length;
const WEB_FETCH_WRAPPER_NO_WARNING_OVERHEAD = wrapExternalContent("", {
  source: "web_fetch",
  includeWarning: false,
}).length;

export type WebFetchRuntimeParams = {
  url: string;
  detail: WebFetchDetailLevel;
  output: WebFetchOutputMode;
  render: WebFetchRenderMode;
  extract: WebFetchExtractVariant;
  mainContentOnly: boolean;
  waitUntil?: WebFetchWaitUntilMode;
  waitFor?: string;
  sessionId?: string;
  extractMode: ExtractMode;
  maxChars: number;
  maxResponseBytes: number;
  maxRedirects: number;
  timeoutSeconds: number;
  cacheTtlMs: number;
  userAgent: string;
  readabilityEnabled: boolean;
  providerFallback: {
    provider: { id: string; label?: string };
    definition: {
      execute: (input: Record<string, unknown>) => Promise<unknown>;
    };
  } | null;
};

type StandardizedWebFetchPayloadParams = {
  providerId?: string;
  fetcher: string;
  usedFallback: boolean;
  rendered: boolean;
  blockedDetected: boolean;
  url: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  title?: string;
  warning?: string;
  detail: WebFetchDetailLevel;
  output: WebFetchOutputMode;
  render: WebFetchRenderMode;
  extractMode: ExtractMode;
  extractor: string;
  content: string;
  plainText?: string;
  fetchedAt: string;
  tookMs: number;
  maxChars: number;
};

export function resolveFetchReadabilityEnabled(fetch?: WebFetchConfig): boolean {
  if (typeof fetch?.readability === "boolean") {
    return fetch.readability;
  }
  return true;
}

export function resolveFetchMaxCharsCap(fetch?: WebFetchConfig): number {
  const raw =
    fetch && "maxCharsCap" in fetch && typeof fetch.maxCharsCap === "number"
      ? fetch.maxCharsCap
      : undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_FETCH_MAX_CHARS;
  }
  return Math.max(100, Math.floor(raw));
}

export function resolveFetchMaxResponseBytes(fetch?: WebFetchConfig): number {
  const raw =
    fetch && "maxResponseBytes" in fetch && typeof fetch.maxResponseBytes === "number"
      ? fetch.maxResponseBytes
      : undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_FETCH_MAX_RESPONSE_BYTES;
  }
  const value = Math.floor(raw);
  return Math.min(FETCH_MAX_RESPONSE_BYTES_MAX, Math.max(FETCH_MAX_RESPONSE_BYTES_MIN, value));
}

export function resolveMaxChars(value: unknown, fallback: number, cap: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(100, Math.floor(parsed));
  return Math.min(clamped, cap);
}

export function resolveMaxRedirects(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.floor(parsed));
}

function looksLikeHtml(value: string): boolean {
  const trimmed = value.trimStart();
  if (!trimmed) {
    return false;
  }
  const head = trimmed.slice(0, 256).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

export function formatWebFetchErrorDetail(params: {
  detail: string;
  contentType?: string | null;
  maxChars?: number;
}): string {
  const { detail, contentType, maxChars = DEFAULT_ERROR_MAX_CHARS } = params;
  if (!detail) {
    return "";
  }
  let text = detail;
  const contentTypeLower = contentType?.toLowerCase();
  if (contentTypeLower?.includes("text/html") || looksLikeHtml(detail)) {
    const rendered = htmlToMarkdown(detail);
    const withTitle = rendered.title ? `${rendered.title}\n${rendered.text}` : rendered.text;
    text = markdownToText(withTitle);
  }
  const truncated = truncateText(text.trim(), maxChars);
  return truncated.text;
}

export function redactUrlForDebugLog(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname && parsed.pathname !== "/" ? `${parsed.origin}/...` : parsed.origin;
  } catch {
    return "[invalid-url]";
  }
}

export function sanitizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeContentType(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const [raw] = value.split(";");
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

function wrapWebFetchContent(
  value: string,
  maxChars: number,
): {
  text: string;
  truncated: boolean;
  rawLength: number;
  wrappedLength: number;
} {
  if (maxChars <= 0) {
    return { text: "", truncated: true, rawLength: 0, wrappedLength: 0 };
  }
  const includeWarning = maxChars >= WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD;
  const wrapperOverhead = includeWarning
    ? WEB_FETCH_WRAPPER_WITH_WARNING_OVERHEAD
    : WEB_FETCH_WRAPPER_NO_WARNING_OVERHEAD;
  if (wrapperOverhead > maxChars) {
    const minimal = includeWarning
      ? wrapWebContent("", "web_fetch")
      : wrapExternalContent("", { source: "web_fetch", includeWarning: false });
    const truncatedWrapper = truncateText(minimal, maxChars);
    return {
      text: truncatedWrapper.text,
      truncated: true,
      rawLength: 0,
      wrappedLength: truncatedWrapper.text.length,
    };
  }
  const maxInner = Math.max(0, maxChars - wrapperOverhead);
  let truncated = truncateText(value, maxInner);
  let wrappedText = includeWarning
    ? wrapWebContent(truncated.text, "web_fetch")
    : wrapExternalContent(truncated.text, { source: "web_fetch", includeWarning: false });

  if (wrappedText.length > maxChars) {
    const excess = wrappedText.length - maxChars;
    const adjustedMaxInner = Math.max(0, maxInner - excess);
    truncated = truncateText(value, adjustedMaxInner);
    wrappedText = includeWarning
      ? wrapWebContent(truncated.text, "web_fetch")
      : wrapExternalContent(truncated.text, { source: "web_fetch", includeWarning: false });
  }

  return {
    text: wrappedText,
    truncated: truncated.truncated,
    rawLength: truncated.text.length,
    wrappedLength: wrappedText.length,
  };
}

function wrapWebFetchField(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  return wrapExternalContent(value, { source: "web_fetch", includeWarning: false });
}

function wrapOptionalString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return wrapWebFetchField(value);
}

function wrapStringArray(values: string[]): string[] | undefined {
  const wrapped = values.map((entry) => wrapWebFetchField(entry)).filter(Boolean) as string[];
  return wrapped.length > 0 ? wrapped : undefined;
}

export function standardizeWebFetchPayload(
  params: StandardizedWebFetchPayloadParams,
): Record<string, unknown> {
  const shaped = buildWebFetchContentShape({
    detail: params.detail,
    output: params.output,
    extractMode: params.extractMode,
    maxChars: params.maxChars,
    content: params.content,
    plainText:
      params.plainText ??
      resolvePlainTextContent({
        content: params.content,
        output: params.output,
        extractMode: params.extractMode,
      }),
  });

  const wrappedPrimary = wrapWebFetchContent(shaped.primaryText, params.maxChars);
  const wrappedTitle = wrapOptionalString(params.title);
  const wrappedWarning = wrapOptionalString(params.warning);
  const wrappedSummary = wrapOptionalString(shaped.summary);
  const wrappedPreview = wrapOptionalString(shaped.contentPreview);
  const wrappedKeyPoints = wrapStringArray(shaped.keyPoints);
  const wrappedHeadings = wrapStringArray(shaped.headings);
  const wrappedContent = params.detail === "brief" ? undefined : wrapOptionalString(shaped.content);

  return {
    url: params.url,
    finalUrl: params.finalUrl,
    status: params.status,
    ...(params.contentType ? { contentType: params.contentType } : {}),
    ...(wrappedTitle ? { title: wrappedTitle } : {}),
    detail: params.detail,
    output: params.output,
    render: params.render,
    extractMode: params.extractMode,
    extractor: params.extractor,
    fetcher: params.fetcher,
    rendered: params.rendered,
    usedFallback: params.usedFallback,
    blockedDetected: params.blockedDetected,
    externalContent: {
      untrusted: true,
      source: "web_fetch",
      wrapped: true,
      ...(params.providerId ? { provider: params.providerId } : {}),
    },
    truncated: wrappedPrimary.truncated || shaped.truncated,
    contentOmitted: shaped.contentOmitted,
    length: wrappedPrimary.wrappedLength,
    rawLength: wrappedPrimary.rawLength,
    wrappedLength: wrappedPrimary.wrappedLength,
    estimatedTokens: shaped.estimatedTokens,
    ...(wrappedSummary ? { summary: wrappedSummary } : {}),
    ...(wrappedKeyPoints ? { keyPoints: wrappedKeyPoints } : {}),
    ...(wrappedHeadings ? { headings: wrappedHeadings } : {}),
    ...(wrappedPreview ? { contentPreview: wrappedPreview } : {}),
    ...(wrappedContent ? { content: wrappedContent } : {}),
    fetchedAt: params.fetchedAt,
    tookMs: params.tookMs,
    text: wrappedPrimary.text,
    ...(wrappedWarning ? { warning: wrappedWarning } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProviderFinalUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) {
      return undefined;
    }
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeProviderWebFetchPayload(params: {
  providerId: string;
  payload: unknown;
  requestedUrl: string;
  detail: WebFetchDetailLevel;
  output: WebFetchOutputMode;
  render: WebFetchRenderMode;
  extractMode: ExtractMode;
  maxChars: number;
  tookMs: number;
  usedFallback: boolean;
}): Record<string, unknown> {
  const payload = isRecord(params.payload) ? params.payload : {};
  const rawText = sanitizeOptionalString(payload.text) ?? "";
  const rawContent = sanitizeOptionalString(payload.content) ?? rawText;
  const plainText =
    sanitizeOptionalString(payload.contentPreview) ??
    sanitizeOptionalString(payload.summary) ??
    rawText;
  const url = params.requestedUrl;
  const finalUrl = normalizeProviderFinalUrl(payload.finalUrl) ?? url;
  const status =
    typeof payload.status === "number" && Number.isFinite(payload.status)
      ? Math.max(0, Math.floor(payload.status))
      : 200;
  const contentType =
    typeof payload.contentType === "string" ? normalizeContentType(payload.contentType) : undefined;
  const extractor =
    typeof payload.extractor === "string" && payload.extractor.trim()
      ? payload.extractor
      : params.providerId;
  return standardizeWebFetchPayload({
    providerId: params.providerId,
    fetcher:
      sanitizeOptionalString(payload.fetcher) ??
      sanitizeOptionalString(payload.provider) ??
      params.providerId,
    usedFallback:
      typeof payload.usedFallback === "boolean" ? payload.usedFallback : params.usedFallback,
    rendered: typeof payload.rendered === "boolean" ? payload.rendered : params.render !== "never",
    blockedDetected: typeof payload.blockedDetected === "boolean" ? payload.blockedDetected : false,
    url,
    finalUrl,
    status,
    ...(contentType ? { contentType } : {}),
    title: sanitizeOptionalString(payload.title),
    warning: sanitizeOptionalString(payload.warning),
    detail: params.detail,
    output: params.output,
    render: params.render,
    extractMode: params.extractMode,
    extractor,
    content: rawContent,
    plainText,
    fetchedAt:
      typeof payload.fetchedAt === "string" && payload.fetchedAt
        ? payload.fetchedAt
        : new Date().toISOString(),
    tookMs:
      typeof payload.tookMs === "number" && Number.isFinite(payload.tookMs)
        ? Math.max(0, Math.floor(payload.tookMs))
        : params.tookMs,
    maxChars: params.maxChars,
  });
}

export async function maybeFetchProviderWebFetchPayload(params: WebFetchRuntimeParams & {
  urlToFetch: string;
  cacheKey: string;
  tookMs: number;
  usedFallback: boolean;
  ignoreErrorPayloads?: boolean;
  cache: Map<string, CacheEntry<Record<string, unknown>>>;
}): Promise<Record<string, unknown> | null> {
  if (!params.providerFallback) {
    return null;
  }
  let rawPayload: unknown;
  try {
    rawPayload = await params.providerFallback.definition.execute({
      url: params.urlToFetch,
      detail: params.detail,
      output: params.output,
      render: params.render,
      extract: params.extract,
      mainContentOnly: params.mainContentOnly,
      ...(params.waitUntil ? { waitUntil: params.waitUntil } : {}),
      ...(params.waitFor ? { waitFor: params.waitFor } : {}),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      extractMode: params.extractMode,
      maxChars: params.maxChars,
    });
  } catch (error) {
    if (params.ignoreErrorPayloads) {
      return null;
    }
    throw error;
  }
  if (params.ignoreErrorPayloads && isRecord(rawPayload)) {
    const status =
      typeof rawPayload.status === "number" && Number.isFinite(rawPayload.status)
        ? Math.max(0, Math.floor(rawPayload.status))
        : 200;
    if (
      status >= 400 ||
      "error" in rawPayload ||
      (typeof rawPayload.code === "string" && rawPayload.code.trim().length > 0)
    ) {
      return null;
    }
  }
  const payload = normalizeProviderWebFetchPayload({
    providerId: params.providerFallback.provider.id,
    payload: rawPayload,
    requestedUrl: params.url,
    detail: params.detail,
    output: params.output,
    render: params.render,
    extractMode: params.extractMode,
    maxChars: params.maxChars,
    tookMs: params.tookMs,
    usedFallback: params.usedFallback,
  });
  writeCache(params.cache, params.cacheKey, payload, params.cacheTtlMs);
  return payload;
}

export function logWebFetchMarkdownTokens(finalUrl: string, markdownTokens: string) {
  logDebug(`[web-fetch] x-markdown-tokens: ${markdownTokens} (${redactUrlForDebugLog(finalUrl)})`);
}
