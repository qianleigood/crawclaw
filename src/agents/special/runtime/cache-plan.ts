import type { AgentStreamParams } from "../../command/types.js";
import {
  readSpecialAgentCacheSafeParamsSnapshot,
  type SpecialAgentCacheEnvelope,
  type SpecialAgentInheritedPromptEnvelope,
} from "./cache-safe-params.js";
import { normalizeOptionalText } from "./shared.js";
import type { SpecialAgentSpawnRequest } from "./types.js";

export type SpecialAgentProviderCacheHints = AgentStreamParams;

export type SpecialAgentForkCacheMismatch = "query_context" | "fork_context_messages";

export type SpecialAgentForkCachePlan = {
  canReuseParentPrefix: boolean;
  mismatches: SpecialAgentForkCacheMismatch[];
  streamParams?: SpecialAgentProviderCacheHints;
};

function shouldReuseParentPromptCache(definitionId: string): boolean {
  switch (definitionId) {
    case "memory_extractor":
    case "session_summary":
    case "dream":
      return false;
    default:
      return true;
  }
}

function stripInheritedPromptCacheHints(
  streamParams: SpecialAgentProviderCacheHints | undefined,
): SpecialAgentProviderCacheHints | undefined {
  if (!streamParams) {
    return undefined;
  }
  const stripped = {
    ...(streamParams.cacheRetention ? { cacheRetention: streamParams.cacheRetention } : {}),
    ...(streamParams.skipCacheWrite === true ? { skipCacheWrite: true } : {}),
  };
  return Object.keys(stripped).length > 0 ? stripped : undefined;
}

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
  const promptCachePolicy = cachePolicy?.promptCache;
  if (promptCachePolicy?.scope === "parent_session") {
    if (!shouldReuseParentPromptCache(params.definition.id)) {
      return mergeProviderCacheHints(resolved, params.spawnOverrides?.streamParams);
    }
    const snapshot = params.parentRunId
      ? await readSpecialAgentCacheSafeParamsSnapshot(params.parentRunId)
      : null;
    const keyNamespace =
      normalizeOptionalText(promptCachePolicy.keyNamespace) ?? params.definition.spawnSource;
    const explicitParentKey = normalizeOptionalText(snapshot?.streamParams.promptCacheKey);
    const queryContextDerivedKey =
      normalizeOptionalText(snapshot?.queryContextHash) ??
      normalizeOptionalText(snapshot?.cacheIdentity.queryContextHash);
    const envelopeDerivedKey = queryContextDerivedKey
      ? `${keyNamespace}:${queryContextDerivedKey}`
      : undefined;
    const compatParentSessionKey =
      normalizeOptionalText(params.spawnContext?.agentSessionKey) ??
      normalizeOptionalText(snapshot?.sessionKey);
    const promptCacheKey =
      explicitParentKey ??
      envelopeDerivedKey ??
      (compatParentSessionKey ? `${keyNamespace}:${compatParentSessionKey}` : undefined);
    if (promptCacheKey) {
      resolved.promptCacheKey = promptCacheKey;
    }
    const promptCacheRetention =
      normalizeOptionalText(snapshot?.streamParams.promptCacheRetention) ??
      normalizeOptionalText(promptCachePolicy.retention);
    if (promptCacheRetention) {
      resolved.promptCacheRetention = promptCacheRetention;
    }
  }
  return mergeProviderCacheHints(resolved, params.spawnOverrides?.streamParams);
}

export function buildSpecialAgentForkCachePlan(params: {
  inheritedEnvelope?: SpecialAgentInheritedPromptEnvelope;
  currentEnvelope?: SpecialAgentCacheEnvelope;
  streamParams?: SpecialAgentProviderCacheHints;
}): SpecialAgentForkCachePlan {
  if (!params.inheritedEnvelope || !params.currentEnvelope) {
    return {
      canReuseParentPrefix: true,
      mismatches: [],
      streamParams: params.streamParams,
    };
  }
  const mismatches: SpecialAgentForkCacheMismatch[] = [];
  if (
    params.inheritedEnvelope.cacheIdentity.queryContextHash !==
    params.currentEnvelope.cacheIdentity.queryContextHash
  ) {
    mismatches.push("query_context");
  }
  if (
    params.inheritedEnvelope.cacheIdentity.forkContextMessagesHash !==
    params.currentEnvelope.cacheIdentity.forkContextMessagesHash
  ) {
    mismatches.push("fork_context_messages");
  }
  if (mismatches.length === 0) {
    return {
      canReuseParentPrefix: true,
      mismatches,
      streamParams: params.streamParams,
    };
  }
  return {
    canReuseParentPrefix: false,
    mismatches,
    streamParams: stripInheritedPromptCacheHints(params.streamParams),
  };
}
