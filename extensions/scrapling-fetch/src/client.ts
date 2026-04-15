import type { CrawClawConfig } from "crawclaw/plugin-sdk/config-runtime";
import {
  readResponseText,
  resolveTimeoutSeconds,
  wrapExternalContent,
  wrapWebContent,
} from "crawclaw/plugin-sdk/provider-web-fetch";
import {
  buildScraplingFetchEndpoint,
  resolveScraplingFetchBaseUrl,
  resolveScraplingFetchPluginConfig,
  SCRAPLING_FETCH_DEFAULT_TIMEOUT_SECONDS,
  type ResolvedScraplingFetchPluginConfig,
} from "./config.js";

export type ScraplingFetchOutput = "markdown" | "text" | "html" | "structured";
export type ScraplingFetchDetail = "brief" | "standard" | "full";
export type ScraplingFetchRender = "auto" | "never" | "stealth" | "dynamic";
export type ScraplingFetchExtract = "readable" | "raw" | "links" | "metadata";
export type ScraplingFetchWaitUntil = "domcontentloaded" | "load" | "networkidle";

export type ScraplingFetchRequest = {
  url: string;
  output?: ScraplingFetchOutput;
  extractMode?: "markdown" | "text";
  render?: ScraplingFetchRender;
  detail?: ScraplingFetchDetail;
  extract?: ScraplingFetchExtract;
  mainContentOnly?: boolean;
  maxChars?: number;
  timeoutSeconds?: number;
  waitUntil?: ScraplingFetchWaitUntil;
  waitFor?: string;
  sessionId?: string;
};

export type ScraplingFetchSuccessPayload = Record<string, unknown> & {
  status: "ok";
  provider: "scrapling";
  fetcher: string;
  url: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  title?: string | null;
  summary?: string | null;
  keyPoints?: string[] | null;
  headings?: string[] | null;
  contentPreview?: string | null;
  html?: string | null;
  content?: string | null;
  text?: string | null;
  metadata?: Record<string, unknown> | null;
  externalContent: {
    untrusted: true;
    source: "web_fetch";
    provider: "scrapling";
    wrapped: true;
  };
  rendered: boolean;
  usedFallback: boolean;
  blockedDetected: boolean;
  truncated: boolean;
  length: number;
  rawLength: number;
  wrappedLength: number;
  fetchedAt: string;
  tookMs: number;
  warning?: string | null;
  request: Record<string, unknown>;
};

type ScraplingFetchSidecarPayload = {
  status?: string;
  provider?: string;
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
  request?: Record<string, unknown>;
  statusCode?: number;
  contentType?: string;
  title?: string | null;
  summary?: string | null;
  keyPoints?: unknown;
  headings?: unknown;
  contentPreview?: string | null;
  html?: string | null;
  content?: string | null;
  text?: string | null;
  metadata?: Record<string, unknown> | null;
  fetcher?: string;
  rendered?: boolean;
  usedFallback?: boolean;
  blockedDetected?: boolean;
  truncated?: boolean;
  length?: number;
  rawLength?: number;
  wrappedLength?: number;
  fetchedAt?: string;
  tookMs?: number;
  warning?: string | null;
  finalUrl?: string;
  url?: string;
};

type ScraplingFetchConfigView = ResolvedScraplingFetchPluginConfig;

function toPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
  return result.length ? result : null;
}

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeRequest(
  params: ScraplingFetchRequest,
  config: ScraplingFetchConfigView,
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    url: params.url,
    output: params.output ?? "markdown",
    detail: params.detail ?? "brief",
    render: params.render ?? "auto",
    extractMode: params.extractMode ?? "markdown",
    extract: params.extract ?? "readable",
    mainContentOnly: params.mainContentOnly ?? config.webFetch.onlyMainContent,
  };
  if (typeof params.maxChars === "number" && Number.isFinite(params.maxChars)) {
    request.maxChars = Math.floor(params.maxChars);
  }
  const timeoutSeconds = toPositiveInteger(
    params.timeoutSeconds,
    resolveTimeoutSeconds(config.webFetch.timeoutSeconds, SCRAPLING_FETCH_DEFAULT_TIMEOUT_SECONDS),
  );
  request.timeoutSeconds = timeoutSeconds;
  if (params.waitUntil) {
    request.waitUntil = params.waitUntil;
  }
  if (typeof params.waitFor === "string" && params.waitFor.trim()) {
    request.waitFor = params.waitFor.trim();
  }
  if (typeof params.sessionId === "string" && params.sessionId.trim()) {
    request.sessionId = params.sessionId.trim();
  }
  return request;
}

function extractErrorMessage(payload: ScraplingFetchSidecarPayload, fallback: string): string {
  return (
    normalizeText(payload.message) ??
    normalizeText(payload.details?.error) ??
    normalizeText(payload.details?.message) ??
    fallback
  );
}

function normalizeStatusCode(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
}

function normalizeSuccessPayload(
  payload: ScraplingFetchSidecarPayload,
  request: Record<string, unknown>,
): ScraplingFetchSuccessPayload {
  const text = normalizeText(payload.text) ?? normalizeText(payload.content) ?? "";
  const html = normalizeText(payload.html);
  const summary = normalizeText(payload.summary);
  const contentPreview = normalizeText(payload.contentPreview) ?? summary ?? text.slice(0, 2_000);
  const content = normalizeText(payload.content) ?? text;
  const statusCode = normalizeStatusCode(payload.statusCode, 200);
  const title = normalizeText(payload.title);
  const metadata = normalizeMetadata(payload.metadata);
  const keyPoints = normalizeStringArray(payload.keyPoints);
  const headings = normalizeStringArray(payload.headings);
  const provider = "scrapling" as const;
  const wrappedText = wrapExternalContent(text, { source: "web_fetch" });
  const wrappedContent = content ? wrapWebContent(content, "web_fetch") : wrappedText;
  const wrappedPreview = wrapWebContent(contentPreview, "web_fetch");
  const wrappedSummary = summary ? wrapWebContent(summary, "web_fetch") : null;

  return {
    status: "ok",
    provider,
    fetcher: normalizeText(payload.fetcher) ?? "scrapling-sidecar",
    url: normalizeText(payload.url) ?? normalizeText(request.url) ?? "",
    finalUrl:
      normalizeText(payload.finalUrl) ??
      normalizeText(payload.url) ??
      normalizeText(request.url) ??
      "",
    statusCode,
    contentType: normalizeText(payload.contentType) ?? (html ? "text/html" : "text/plain"),
    title,
    summary: wrappedSummary,
    keyPoints,
    headings,
    contentPreview: wrappedPreview,
    html: html ? wrapWebContent(html, "web_fetch") : null,
    content: wrappedContent,
    text: wrappedText,
    metadata,
    externalContent: {
      untrusted: true,
      source: "web_fetch",
      provider,
      wrapped: true,
    },
    rendered: Boolean(payload.rendered),
    usedFallback: Boolean(payload.usedFallback),
    blockedDetected: Boolean(payload.blockedDetected),
    truncated: Boolean(payload.truncated),
    length: normalizeStatusCode(payload.length, wrappedText.length),
    rawLength: normalizeStatusCode(payload.rawLength, wrappedText.length),
    wrappedLength: normalizeStatusCode(payload.wrappedLength, wrappedText.length),
    fetchedAt: normalizeText(payload.fetchedAt) ?? new Date().toISOString(),
    tookMs: normalizeStatusCode(payload.tookMs, 0),
    warning: normalizeText(payload.warning),
    request,
  };
}

async function readJsonPayload(response: Response): Promise<ScraplingFetchSidecarPayload> {
  const body = await readResponseText(response, { maxBytes: 256_000 });
  if (!body.text.trim()) {
    return {};
  }
  try {
    return JSON.parse(body.text) as ScraplingFetchSidecarPayload;
  } catch (error) {
    throw new ScraplingFetchUnavailableError("Scrapling sidecar returned invalid JSON.", {
      responseStatus: response.status,
      responseText: body.text.slice(0, 2_000),
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildErrorDetails(
  payload: ScraplingFetchSidecarPayload,
  response: Response | undefined,
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    responseStatus: response?.status,
    responseStatusText: response?.statusText,
  };
  if (payload.code) {
    details.code = payload.code;
  }
  if (payload.details) {
    details.payloadDetails = payload.details;
  }
  if (payload.request) {
    details.request = payload.request;
  }
  return details;
}

export class ScraplingFetchUnavailableError extends Error {
  readonly code = "SCRAPLING_FETCH_UNAVAILABLE";
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ScraplingFetchUnavailableError";
    this.details = details;
  }
}

export class ScraplingFetchError extends Error {
  readonly code = "SCRAPLING_FETCH_ERROR";
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ScraplingFetchError";
    this.details = details;
  }
}

export class ScraplingFetchClient {
  readonly config: ScraplingFetchConfigView;

  constructor(config?: CrawClawConfig | ScraplingFetchConfigView) {
    this.config =
      config && "service" in config && "webFetch" in config
        ? (config as ScraplingFetchConfigView)
        : resolveScraplingFetchPluginConfig(config as CrawClawConfig | undefined);
  }

  get baseUrl(): string {
    return resolveScraplingFetchBaseUrl(this.config);
  }

  get healthUrl(): string {
    return buildScraplingFetchEndpoint(
      this.config.service.baseUrl,
      this.config.service.healthcheckPath,
    );
  }

  get fetchUrl(): string {
    return buildScraplingFetchEndpoint(this.baseUrl, this.config.service.fetchPath);
  }

  async checkHealth(): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(this.healthUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new ScraplingFetchUnavailableError(
        "Unable to reach Scrapling sidecar health endpoint.",
        {
          healthUrl: this.healthUrl,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
    const payload = await readJsonPayload(response);
    if (!response.ok) {
      throw new ScraplingFetchUnavailableError(
        extractErrorMessage(payload, `Scrapling health check failed (${response.status}).`),
        buildErrorDetails(payload, response),
      );
    }
    return payload;
  }

  async fetchPage(request: ScraplingFetchRequest): Promise<ScraplingFetchSuccessPayload> {
    const normalizedRequest = normalizeRequest(request, this.config);
    let response: Response;
    try {
      response = await fetch(this.fetchUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(normalizedRequest),
        signal: AbortSignal.timeout(
          toPositiveInteger(
            request.timeoutSeconds,
            resolveTimeoutSeconds(
              this.config.webFetch.timeoutSeconds,
              SCRAPLING_FETCH_DEFAULT_TIMEOUT_SECONDS,
            ),
          ) * 1_000,
        ),
      });
    } catch (error) {
      throw new ScraplingFetchUnavailableError("Unable to reach Scrapling sidecar.", {
        fetchUrl: this.fetchUrl,
        cause: error instanceof Error ? error.message : String(error),
        request: normalizedRequest,
      });
    }

    const payload = await readJsonPayload(response);
    const responseStatus = normalizeText(payload.status) ?? (response.ok ? "ok" : "error");
    if (responseStatus === "error") {
      throw new ScraplingFetchError(
        extractErrorMessage(payload, `Scrapling sidecar error (${response.status}).`),
        buildErrorDetails(payload, response),
      );
    }
    if (responseStatus === "unavailable") {
      throw new ScraplingFetchUnavailableError(
        extractErrorMessage(payload, `Scrapling sidecar unavailable (${response.status}).`),
        buildErrorDetails(payload, response),
      );
    }
    if (!response.ok) {
      throw new ScraplingFetchUnavailableError(
        extractErrorMessage(payload, `Scrapling sidecar unavailable (${response.status}).`),
        buildErrorDetails(payload, response),
      );
    }
    if (responseStatus !== "ok") {
      throw new ScraplingFetchError(
        "Scrapling sidecar returned an unexpected payload.",
        buildErrorDetails(payload, response),
      );
    }
    return normalizeSuccessPayload(payload, normalizedRequest);
  }
}

export const __testing = {
  buildErrorDetails,
  extractErrorMessage,
  normalizeMetadata,
  normalizeRequest,
  normalizeStatusCode,
  normalizeSuccessPayload,
  normalizeStringArray,
  normalizeText,
  readJsonPayload,
  toPositiveInteger,
};
