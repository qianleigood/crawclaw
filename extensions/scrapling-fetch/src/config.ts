import type { CrawClawConfig } from "crawclaw/plugin-sdk/config-runtime";

export const SCRAPLING_FETCH_PLUGIN_ID = "scrapling-fetch";
export const SCRAPLING_FETCH_PROVIDER_ID = "scrapling";
export const SCRAPLING_FETCH_SERVICE_ID = "scrapling-fetch-service";
export const SCRAPLING_FETCH_DEFAULT_BASE_URL = "http://127.0.0.1:32119";
export const SCRAPLING_FETCH_DEFAULT_HEALTHCHECK_PATH = "/health";
export const SCRAPLING_FETCH_DEFAULT_FETCH_PATH = "/fetch";
export const SCRAPLING_FETCH_DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
export const SCRAPLING_FETCH_DEFAULT_TIMEOUT_SECONDS = 30;
export const SCRAPLING_FETCH_DEFAULT_BOOTSTRAP_ENABLED = true;
export const SCRAPLING_FETCH_DEFAULT_BOOTSTRAP_PACKAGES = [
  "Scrapling==0.4.4",
  "curl-cffi==0.15.0",
  "playwright==1.58.0",
  "browserforge==1.2.4",
  "patchright==1.58.2",
  "msgspec==0.20.0",
] as const;

export type ScraplingFetchServiceMode = "python-http";

export type ScraplingFetchPluginConfig = {
  webFetch?: {
    apiKey?: unknown;
    baseUrl?: string;
    timeoutSeconds?: number;
    onlyMainContent?: boolean;
  };
  service?: {
    enabled?: boolean;
    mode?: ScraplingFetchServiceMode;
    baseUrl?: string;
    command?: string;
    args?: string[];
    bootstrap?: boolean;
    bootstrapPackages?: string[];
    startupTimeoutMs?: number;
    healthcheckPath?: string;
    fetchPath?: string;
  };
};

export type ResolvedScraplingFetchPluginConfig = {
  webFetch: {
    apiKey?: unknown;
    baseUrl?: string;
    timeoutSeconds: number;
    onlyMainContent: boolean;
  };
  service: {
    enabled: boolean;
    mode: ScraplingFetchServiceMode;
    baseUrl: string;
    command: string;
    args: string[];
    bootstrap: boolean;
    bootstrapPackages: string[];
    startupTimeoutMs: number;
    healthcheckPath: string;
    fetchPath: string;
  };
};

function readPluginConfig(config?: CrawClawConfig): ScraplingFetchPluginConfig {
  const raw = config?.plugins?.entries?.[SCRAPLING_FETCH_PLUGIN_ID]?.config;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as ScraplingFetchPluginConfig;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizePath(value: unknown, fallback: string): string {
  const normalized = normalizeString(value) ?? fallback;
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  return value?.trim().replace(/\/+$/u, "") || undefined;
}

export function resolveScraplingFetchPluginConfig(
  config?: CrawClawConfig,
): ResolvedScraplingFetchPluginConfig {
  const pluginConfig = readPluginConfig(config);
  const webFetch = pluginConfig.webFetch ?? {};
  const service = pluginConfig.service ?? {};
  const bootstrapPackages = normalizeStringArray(service.bootstrapPackages);

  return {
    webFetch: {
      apiKey: webFetch.apiKey,
      baseUrl: normalizeBaseUrl(normalizeString(webFetch.baseUrl)),
      timeoutSeconds: normalizePositiveNumber(
        webFetch.timeoutSeconds,
        SCRAPLING_FETCH_DEFAULT_TIMEOUT_SECONDS,
      ),
      onlyMainContent: webFetch.onlyMainContent !== false,
    },
    service: {
      enabled: service.enabled !== false,
      mode: "python-http",
      baseUrl:
        normalizeBaseUrl(normalizeString(service.baseUrl)) ?? SCRAPLING_FETCH_DEFAULT_BASE_URL,
      command: normalizeString(service.command) ?? "python3",
      args: normalizeStringArray(service.args),
      bootstrap: service.bootstrap !== false,
      bootstrapPackages:
        bootstrapPackages.length > 0
          ? bootstrapPackages
          : [...SCRAPLING_FETCH_DEFAULT_BOOTSTRAP_PACKAGES],
      startupTimeoutMs: normalizePositiveNumber(
        service.startupTimeoutMs,
        SCRAPLING_FETCH_DEFAULT_STARTUP_TIMEOUT_MS,
      ),
      healthcheckPath: normalizePath(
        service.healthcheckPath,
        SCRAPLING_FETCH_DEFAULT_HEALTHCHECK_PATH,
      ),
      fetchPath: normalizePath(service.fetchPath, SCRAPLING_FETCH_DEFAULT_FETCH_PATH),
    },
  };
}

export function resolveScraplingFetchBaseUrl(config: ResolvedScraplingFetchPluginConfig): string {
  return config.webFetch.baseUrl ?? config.service.baseUrl;
}

export function buildScraplingFetchEndpoint(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  url.pathname = path.startsWith("/") ? path : `/${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
