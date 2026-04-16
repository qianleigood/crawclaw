import type { CrawClawConfig } from "../plugin-sdk/config-runtime.js";
import {
  normalizeResolvedSecretInputString,
  normalizeSecretInput,
} from "../plugin-sdk/secret-input.js";

type OpenWebSearchPluginConfig = {
  webSearch?: {
    baseUrl?: unknown;
    engines?: unknown;
    autoStart?: unknown;
    host?: unknown;
    port?: unknown;
    startupTimeoutMs?: unknown;
  };
};

export const DEFAULT_OPEN_WEBSEARCH_HOST = "127.0.0.1";
export const DEFAULT_OPEN_WEBSEARCH_PORT = 3210;
export const DEFAULT_OPEN_WEBSEARCH_STARTUP_TIMEOUT_MS = 20_000;
export const DEFAULT_OPEN_WEBSEARCH_ENGINES = [
  "duckduckgo",
  "bing",
  "brave",
  "exa",
  "baidu",
  "juejin",
] as const;

function normalizeConfiguredString(value: unknown, path: string): string | undefined {
  try {
    return normalizeSecretInput(
      normalizeResolvedSecretInputString({
        value,
        path,
      }),
    );
  } catch {
    return undefined;
  }
}

function readInlineEnvSecretRefValue(value: unknown, env: NodeJS.ProcessEnv): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as { source?: unknown; id?: unknown };
  if (record.source !== "env" || typeof record.id !== "string") {
    return undefined;
  }
  return normalizeSecretInput(env[record.id]);
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  return value?.trim().replace(/\/+$/u, "") || undefined;
}

function normalizeHost(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeEngineValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed || undefined;
}

function normalizeEngineList(value: unknown): string[] | undefined {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  if (rawValues.length === 0) {
    return undefined;
  }
  const engines = rawValues
    .map((entry) => normalizeEngineValue(entry))
    .filter((entry): entry is string => Boolean(entry));
  return engines.length > 0 ? [...new Set(engines)] : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "true" || trimmed === "1" || trimmed === "yes" || trimmed === "on") {
    return true;
  }
  if (trimmed === "false" || trimmed === "0" || trimmed === "no" || trimmed === "off") {
    return false;
  }
  return undefined;
}

function normalizePort(value: unknown): number | undefined {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(raw) || raw < 1 || raw > 65_535) {
    return undefined;
  }
  return raw;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(raw) || raw <= 0) {
    return undefined;
  }
  return raw;
}

export function resolveOpenWebSearchConfig(
  config?: CrawClawConfig,
): OpenWebSearchPluginConfig["webSearch"] | undefined {
  const pluginConfig = config?.plugins?.entries?.["open-websearch"]?.config as
    | OpenWebSearchPluginConfig
    | undefined;
  const webSearch = pluginConfig?.webSearch;
  if (webSearch && typeof webSearch === "object" && !Array.isArray(webSearch)) {
    return webSearch;
  }
  return undefined;
}

export function resolveOpenWebSearchBaseUrl(
  config?: CrawClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const webSearch = resolveOpenWebSearchConfig(config);
  return (
    normalizeBaseUrl(
      normalizeConfiguredString(
        webSearch?.baseUrl,
        "plugins.entries.open-websearch.config.webSearch.baseUrl",
      ),
    ) ??
    normalizeBaseUrl(readInlineEnvSecretRefValue(webSearch?.baseUrl, env)) ??
    normalizeBaseUrl(normalizeSecretInput(env.OPEN_WEBSEARCH_BASE_URL)) ??
    `http://${resolveOpenWebSearchHost(config, env)}:${resolveOpenWebSearchPort(config, env)}`
  );
}

export function resolveOpenWebSearchDefaultEngines(
  config?: CrawClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const webSearch = resolveOpenWebSearchConfig(config);
  return (
    normalizeEngineList(webSearch?.engines) ??
    normalizeEngineList(normalizeSecretInput(env.OPEN_WEBSEARCH_ENGINES)) ?? [
      ...DEFAULT_OPEN_WEBSEARCH_ENGINES,
    ]
  );
}

export function resolveOpenWebSearchAutoStart(
  config?: CrawClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const webSearch = resolveOpenWebSearchConfig(config);
  return (
    normalizeBoolean(webSearch?.autoStart) ??
    normalizeBoolean(env.OPEN_WEBSEARCH_AUTO_START) ??
    true
  );
}

export function resolveOpenWebSearchHost(
  config?: CrawClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const webSearch = resolveOpenWebSearchConfig(config);
  return (
    normalizeHost(
      normalizeConfiguredString(
        webSearch?.host,
        "plugins.entries.open-websearch.config.webSearch.host",
      ),
    ) ??
    normalizeHost(normalizeSecretInput(env.OPEN_WEBSEARCH_HOST)) ??
    DEFAULT_OPEN_WEBSEARCH_HOST
  );
}

export function resolveOpenWebSearchPort(
  config?: CrawClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const webSearch = resolveOpenWebSearchConfig(config);
  return (
    normalizePort(webSearch?.port) ??
    normalizePort(normalizeSecretInput(env.OPEN_WEBSEARCH_PORT)) ??
    DEFAULT_OPEN_WEBSEARCH_PORT
  );
}

export function resolveOpenWebSearchStartupTimeoutMs(
  config?: CrawClawConfig,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const webSearch = resolveOpenWebSearchConfig(config);
  return (
    normalizePositiveInteger(webSearch?.startupTimeoutMs) ??
    normalizePositiveInteger(normalizeSecretInput(env.OPEN_WEBSEARCH_STARTUP_TIMEOUT_MS)) ??
    DEFAULT_OPEN_WEBSEARCH_STARTUP_TIMEOUT_MS
  );
}
