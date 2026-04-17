import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { PluginRuntime } from "./runtime/types.js";
import type { CrawClawPluginDefinition } from "./types.js";

export const PLUGIN_ENTRY_TYPE_FIELD = "__crawclawEntryType";

export type CrawClawPluginEntryType = "plugin" | "channel" | "setup";

type EntryTypeCarrier = {
  [PLUGIN_ENTRY_TYPE_FIELD]?: CrawClawPluginEntryType;
};

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

export function resolveChannelPluginModuleEntry(moduleExport: unknown): {
  channelPlugin?: ChannelPlugin;
  setChannelRuntime?: (runtime: PluginRuntime) => void;
} {
  const resolved = normalizeModuleDefault(moduleExport);
  if (!resolved || typeof resolved !== "object") {
    return {};
  }
  const record = resolved as EntryTypeCarrier & {
    channelPlugin?: unknown;
    setChannelRuntime?: unknown;
  };
  if (!record.channelPlugin || typeof record.channelPlugin !== "object") {
    return {};
  }
  return {
    channelPlugin: record.channelPlugin as ChannelPlugin,
    ...(typeof record.setChannelRuntime === "function"
      ? { setChannelRuntime: record.setChannelRuntime as (runtime: PluginRuntime) => void }
      : {}),
  };
}

export function resolveSetupChannelRegistration(moduleExport: unknown): {
  plugin?: ChannelPlugin;
} {
  const resolved = normalizeModuleDefault(moduleExport);
  if (!resolved || typeof resolved !== "object") {
    return {};
  }
  const record = resolved as EntryTypeCarrier & {
    plugin?: unknown;
  };
  if (!record.plugin || typeof record.plugin !== "object") {
    return {};
  }
  return {
    plugin: record.plugin as ChannelPlugin,
  };
}
