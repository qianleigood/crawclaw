import { BUNDLED_WEB_SEARCH_PROVIDER_PLUGIN_IDS } from "../plugins/bundled-capability-metadata.js";
import type { CrawClawConfig } from "./config.js";
import type { LegacyConfigIssue } from "./types.js";

type JsonRecord = Record<string, unknown>;

const LEGACY_WEB_SEARCH_PROVIDER_PLUGIN_IDS = Object.fromEntries(
  Object.entries(BUNDLED_WEB_SEARCH_PROVIDER_PLUGIN_IDS),
);
const LEGACY_WEB_SEARCH_PROVIDER_IDS = Object.keys(LEGACY_WEB_SEARCH_PROVIDER_PLUGIN_IDS);
const LEGACY_GLOBAL_WEB_SEARCH_PROVIDER_ID = "brave";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveLegacySearchConfig(raw: unknown): JsonRecord | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const tools = isRecord(raw.tools) ? raw.tools : undefined;
  const web = isRecord(tools?.web) ? tools.web : undefined;
  return isRecord(web?.search) ? web.search : undefined;
}

function copyLegacyProviderConfig(search: JsonRecord, providerKey: string): JsonRecord | undefined {
  const current = search[providerKey];
  return isRecord(current) ? { ...current } : undefined;
}

function resolveLegacyGlobalWebSearchTarget(search: JsonRecord): {
  legacyPath: string;
  targetPath: string;
} | null {
  const legacyProviderConfig = copyLegacyProviderConfig(
    search,
    LEGACY_GLOBAL_WEB_SEARCH_PROVIDER_ID,
  );
  const hasLegacyApiKey = Object.prototype.hasOwnProperty.call(search, "apiKey");
  if (
    !hasLegacyApiKey &&
    (!legacyProviderConfig || Object.keys(legacyProviderConfig).length === 0)
  ) {
    return null;
  }
  const pluginId =
    LEGACY_WEB_SEARCH_PROVIDER_PLUGIN_IDS[LEGACY_GLOBAL_WEB_SEARCH_PROVIDER_ID] ??
    LEGACY_GLOBAL_WEB_SEARCH_PROVIDER_ID;
  return {
    legacyPath: hasLegacyApiKey
      ? "tools.web.search.apiKey"
      : `tools.web.search.${LEGACY_GLOBAL_WEB_SEARCH_PROVIDER_ID}`,
    targetPath:
      hasLegacyApiKey && !legacyProviderConfig
        ? `plugins.entries.${pluginId}.config.webSearch.apiKey`
        : `plugins.entries.${pluginId}.config.webSearch`,
  };
}

export function listLegacyWebSearchConfigPaths(raw: unknown): string[] {
  const search = resolveLegacySearchConfig(raw);
  if (!search) {
    return [];
  }

  const paths: string[] = [];
  if ("apiKey" in search) {
    paths.push("tools.web.search.apiKey");
  }
  for (const providerId of LEGACY_WEB_SEARCH_PROVIDER_IDS) {
    const scoped = search[providerId];
    if (!isRecord(scoped)) {
      continue;
    }
    for (const key of Object.keys(scoped)) {
      paths.push(`tools.web.search.${providerId}.${key}`);
    }
  }
  return paths;
}

export function findLegacyWebSearchConfigIssues(raw: unknown): LegacyConfigIssue[] {
  const search = resolveLegacySearchConfig(raw);
  if (!search) {
    return [];
  }

  const issues: LegacyConfigIssue[] = [];
  const legacyGlobalTarget = resolveLegacyGlobalWebSearchTarget(search);
  if (legacyGlobalTarget) {
    issues.push({
      path: legacyGlobalTarget.legacyPath,
      message: `${legacyGlobalTarget.legacyPath} was removed; use ${legacyGlobalTarget.targetPath} instead.`,
    });
  }

  for (const providerId of LEGACY_WEB_SEARCH_PROVIDER_IDS) {
    if (providerId === LEGACY_GLOBAL_WEB_SEARCH_PROVIDER_ID) {
      continue;
    }
    const scoped = copyLegacyProviderConfig(search, providerId);
    if (!scoped || Object.keys(scoped).length === 0) {
      continue;
    }
    const pluginId = LEGACY_WEB_SEARCH_PROVIDER_PLUGIN_IDS[providerId];
    if (!pluginId) {
      continue;
    }
    issues.push({
      path: `tools.web.search.${providerId}`,
      message:
        `tools.web.search.${providerId} was removed; ` +
        `use plugins.entries.${pluginId}.config.webSearch instead.`,
    });
  }

  return issues;
}

export function migrateLegacyWebSearchConfig<T>(raw: T): { config: T; changes: string[] } {
  return { config: raw, changes: [] };
}

export function resolvePluginWebSearchConfig(
  config: CrawClawConfig | undefined,
  pluginId: string,
): Record<string, unknown> | undefined {
  const pluginConfig = config?.plugins?.entries?.[pluginId]?.config;
  if (!isRecord(pluginConfig)) {
    return undefined;
  }
  const webSearch = pluginConfig.webSearch;
  return isRecord(webSearch) ? webSearch : undefined;
}
