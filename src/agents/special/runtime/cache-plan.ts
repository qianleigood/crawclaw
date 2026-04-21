import type { AgentStreamParams } from "../../command/types.js";
import type { SpecialAgentSpawnRequest } from "./types.js";

export type SpecialAgentProviderCacheHints = AgentStreamParams;

function mergeProviderCacheHints(
  base: SpecialAgentProviderCacheHints,
  override: AgentStreamParams | undefined,
): SpecialAgentProviderCacheHints | undefined {
  const merged = {
    ...base,
    ...override,
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export async function resolveSpecialAgentCacheHints(
  params: SpecialAgentSpawnRequest,
): Promise<SpecialAgentProviderCacheHints | undefined> {
  const resolved: SpecialAgentProviderCacheHints = {};
  const cachePolicy = params.definition.cachePolicy;
  if (cachePolicy?.cacheRetention) {
    resolved.cacheRetention = cachePolicy.cacheRetention;
  }
  if (cachePolicy?.skipWrite === true) {
    resolved.skipCacheWrite = true;
  }
  return mergeProviderCacheHints(resolved, params.spawnOverrides?.streamParams);
}
