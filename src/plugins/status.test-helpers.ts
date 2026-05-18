import type { PluginLoadResult } from "./loader.js";
import type { PluginRecord } from "./registry.js";
import type { PluginCompatibilityNotice, PluginStatusReport } from "./status.js";

export const HOOK_ONLY_MESSAGE =
  "is hook-only. This remains a supported compatibility path, but it has not migrated to explicit capability registration yet.";

export function createCompatibilityNotice(
  params: Pick<PluginCompatibilityNotice, "pluginId" | "code">,
): PluginCompatibilityNotice {
  return {
    pluginId: params.pluginId,
    code: params.code,
    severity: "info",
    message: HOOK_ONLY_MESSAGE,
  };
}

export function createPluginRecord(
  overrides: Partial<PluginRecord> & Pick<PluginRecord, "id">,
): PluginRecord {
  const { id, ...rest } = overrides;
  return {
    id,
    name: overrides.name ?? id,
    description: overrides.description ?? "",
    source: overrides.source ?? `/tmp/${id}/index.ts`,
    origin: overrides.origin ?? "workspace",
    enabled: overrides.enabled ?? true,
    explicitlyEnabled: overrides.explicitlyEnabled ?? overrides.enabled ?? true,
    activated: overrides.activated ?? overrides.enabled ?? true,
    activationSource:
      overrides.activationSource ?? ((overrides.enabled ?? true) ? "explicit" : "disabled"),
    activationReason: overrides.activationReason,
    status: overrides.status ?? "loaded",
    toolNames: [],
    hookNames: [],
    providerIds: [],
    webFetchProviderIds: [],
    webSearchProviderIds: [],
    services: [],
    commands: [],
    hookCount: 0,
    configSchema: false,
    ...rest,
  };
}

export function createCustomHook(params: {
  pluginId: string;
  events: string[];
  name?: string;
}): PluginLoadResult["hooks"][number] {
  const source = `/tmp/${params.pluginId}/handler.ts`;
  return {
    pluginId: params.pluginId,
    events: params.events,
    source,
    entry: {
      hook: {
        name: params.name ?? "legacy",
        description: "",
        source: "crawclaw-plugin",
        pluginId: params.pluginId,
        filePath: `/tmp/${params.pluginId}/HOOK.md`,
        baseDir: `/tmp/${params.pluginId}`,
        handlerPath: source,
      },
      frontmatter: {},
    },
  };
}

export function createPluginLoadResult(
  overrides: Partial<PluginLoadResult> & Pick<PluginLoadResult, "plugins"> = { plugins: [] },
): PluginLoadResult {
  const { plugins, ...rest } = overrides;
  return {
    plugins,
    diagnostics: [],
    webFetchProviders: [],
    webSearchProviders: [],
    hooks: [],
    services: [],
    commands: [],
    ...rest,
  };
}

export function createPluginStatusReport(
  overrides: Partial<PluginStatusReport> & Pick<PluginStatusReport, "plugins">,
): PluginStatusReport {
  const { workspaceDir, ...loadResultOverrides } = overrides;
  return {
    workspaceDir,
    ...createPluginLoadResult(loadResultOverrides),
  };
}
