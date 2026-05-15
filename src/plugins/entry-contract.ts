import type { CrawClawPluginDefinition } from "./types.js";

export const PLUGIN_ENTRY_TYPE_FIELD = "__crawclawEntryType";

export type CrawClawPluginEntryType = "plugin";

function normalizeModuleDefault<T>(moduleExport: T): unknown {
  if (!moduleExport || typeof moduleExport !== "object") {
    return moduleExport;
  }
  const record = moduleExport as Record<string, unknown>;
  return "default" in record ? record.default : moduleExport;
}

export function resolvePluginModuleExport(moduleExport: unknown): {
  definition?: CrawClawPluginDefinition;
  register?: CrawClawPluginDefinition["register"];
} {
  const resolved = normalizeModuleDefault(moduleExport);
  if (typeof resolved === "function") {
    return {
      register: resolved as CrawClawPluginDefinition["register"],
    };
  }
  if (resolved && typeof resolved === "object") {
    const definition = resolved as CrawClawPluginDefinition;
    return {
      definition,
      register: definition.register ?? definition.activate,
    };
  }
  return {};
}
