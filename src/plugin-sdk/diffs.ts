// Narrow plugin-sdk surface for the bundled diffs plugin.
// Keep this list additive and scoped to the bundled diffs surface.

export { definePluginEntry } from "./plugin-entry.js";
export type { CrawClawConfig } from "../config/config.js";
export { resolvePreferredCrawClawTmpDir } from "../infra/tmp-crawclaw-dir.js";
export type {
  AnyAgentTool,
  CrawClawPluginApi,
  CrawClawPluginConfigSchema,
  CrawClawPluginToolContext,
  PluginLogger,
} from "../plugins/types.js";
