// Narrow plugin-sdk surface for the bundled llm-task plugin.
// Keep this list additive and scoped to the bundled LLM task surface.

export { definePluginEntry } from "./plugin-entry.js";
export { resolvePreferredCrawClawTmpDir } from "../infra/tmp-crawclaw-dir.js";
export {
  formatThinkingLevels,
  formatXHighModelHint,
  normalizeThinkLevel,
  supportsXHighThinking,
} from "../auto-reply/thinking.js";
export type { AnyAgentTool, CrawClawPluginApi } from "../plugins/types.js";
