type JsonRecord = Record<string, unknown>;
type LegacyConfigIssue = { path: string; message: string };

const XAI_PLUGIN_ID = "xai";
const X_SEARCH_LEGACY_PATH = "tools.web.x_search";
const XAI_WEB_SEARCH_PLUGIN_KEY_PATH = `plugins.entries.${XAI_PLUGIN_ID}.config.webSearch.apiKey`;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveLegacyXSearchConfig(raw: unknown): JsonRecord | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const tools = isRecord(raw.tools) ? raw.tools : undefined;
  const web = isRecord(tools?.web) ? tools.web : undefined;
  return isRecord(web?.x_search) ? web.x_search : undefined;
}

export function listLegacyXSearchConfigPaths(raw: unknown): string[] {
  const legacy = resolveLegacyXSearchConfig(raw);
  if (!legacy || !Object.prototype.hasOwnProperty.call(legacy, "apiKey")) {
    return [];
  }
  return [`${X_SEARCH_LEGACY_PATH}.apiKey`];
}

export function findLegacyXSearchConfigIssues(raw: unknown): LegacyConfigIssue[] {
  const legacy = resolveLegacyXSearchConfig(raw);
  if (!legacy || !Object.prototype.hasOwnProperty.call(legacy, "apiKey")) {
    return [];
  }
  return [
    {
      path: `${X_SEARCH_LEGACY_PATH}.apiKey`,
      message:
        `${X_SEARCH_LEGACY_PATH}.apiKey was removed; ` +
        `use ${XAI_WEB_SEARCH_PLUGIN_KEY_PATH} instead.`,
    },
  ];
}

export function migrateLegacyXSearchConfig<T>(raw: T): { config: T; changes: string[] } {
  return { config: raw, changes: [] };
}
