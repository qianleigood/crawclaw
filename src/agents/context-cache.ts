import type { CacheGovernanceDescriptor } from "../cache/governance-types.js";

export const MODEL_CONTEXT_TOKEN_CACHE = new Map<string, number>();

export const MODEL_CONTEXT_TOKEN_CACHE_DESCRIPTOR: CacheGovernanceDescriptor = {
  id: "agents.context-cache.model-context-tokens",
  module: "src/agents/context-cache.ts",
  category: "runtime_ttl",
  owner: "agent-kernel/context-window-resolution",
  key: "normalized model id",
  lifecycle:
    "Process-local acceleration cache populated from config and model discovery and kept until explicit reset or process restart.",
  invalidation: [
    "clearCachedContextTokens(modelId) deletes a single model entry",
    "clearCachedContextTokens() clears the whole cache",
    "resetContextWindowCacheForTest() clears the cache and loader state",
  ],
  observability: ["getModelContextTokenCacheMeta()", "lookupCachedContextTokens(modelId)"],
};

export function lookupCachedContextTokens(modelId?: string): number | undefined {
  if (!modelId) {
    return undefined;
  }
  return MODEL_CONTEXT_TOKEN_CACHE.get(modelId);
}

export function clearCachedContextTokens(modelId?: string): void {
  if (typeof modelId === "string" && modelId.trim()) {
    MODEL_CONTEXT_TOKEN_CACHE.delete(modelId);
    return;
  }
  MODEL_CONTEXT_TOKEN_CACHE.clear();
}

export function getModelContextTokenCacheMeta(): {
  size: number;
} {
  return {
    size: MODEL_CONTEXT_TOKEN_CACHE.size,
  };
}
