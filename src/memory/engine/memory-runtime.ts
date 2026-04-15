import type { CrawClawConfig } from "../../config/config.js";
import type { CompleteFn } from "../extraction/llm.js";
import type { LlmConfig } from "../types/config.js";
import { resolveConfiguredBuiltInMemoryRuntime } from "./built-in-memory-runtime.js";
import type { MemoryRuntime } from "./types.js";

/**
 * Resolve the built-in memory runtime configured through `memory.notebooklm`.
 */
export async function resolveBuiltInMemoryRuntime(
  config?: CrawClawConfig,
  overrides?: { llm?: LlmConfig; complete?: CompleteFn },
): Promise<MemoryRuntime | undefined> {
  return await resolveConfiguredBuiltInMemoryRuntime(config, overrides);
}
