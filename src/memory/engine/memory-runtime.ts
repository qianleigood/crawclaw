import type { CacheGovernanceDescriptor } from "../../cache/governance-types.js";
import type { CrawClawConfig } from "../../config/config.js";
import type { CompleteFn } from "../extraction/llm.js";
import type { LlmConfig } from "../types/config.js";
import { createRustNativeMemoryRuntime } from "./rust-native-memory-runtime.js";
import type { MemoryRuntime } from "./types.js";

export const RUST_NATIVE_MEMORY_RUNTIME_DESCRIPTOR: CacheGovernanceDescriptor = {
  id: "memory.engine.rust-native-runtime",
  module: "src/memory/engine/memory-runtime.ts",
  category: "runtime_ttl",
  owner: "memory/engine",
  key: "native Rust memory runtime client",
  lifecycle: "Process-local TS callers resolve the native Rust memory runtime.",
  invalidation: ["Runtime root change"],
  observability: ["memory.status"],
};

/**
 * Resolve the built-in memory runtime. Production memory execution is owned by
 * the Rust native runtime; this TS surface only resolves the built-in runtime
 * for remaining TS-owned adapters.
 */
export async function resolveBuiltInMemoryRuntime(
  config?: CrawClawConfig,
  overrides?: { llm?: LlmConfig; complete?: CompleteFn },
): Promise<MemoryRuntime | undefined> {
  void config;
  void overrides;
  return createRustNativeMemoryRuntime();
}
