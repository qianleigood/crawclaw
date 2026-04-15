export type DecisionCodeMap = Record<string, string>;

export function resolveProviderLifecycleDecisionCode(params: {
  phase: "provider_request_start" | "provider_request_stop" | "provider_request_error";
}): string {
  switch (params.phase) {
    case "provider_request_start":
      return "provider_model_selected";
    case "provider_request_stop":
      return "provider_request_completed";
    case "provider_request_error":
      return "provider_request_failed";
    default:
      return "provider_request_failed";
  }
}

export function resolveCompactionLifecycleDecisionCode(params: {
  phase: "pre_compact" | "post_compact";
  trigger?: string | null;
  willRetry?: boolean;
}): string {
  const trigger = params.trigger?.trim() || "unspecified";
  if (params.phase === "pre_compact") {
    if (trigger === "auto_compaction") {
      return "auto_compaction_started";
    }
    if (trigger === "manual") {
      return "manual_compaction_started";
    }
    return `${trigger}_compaction_started`;
  }
  if (params.willRetry) {
    return "compaction_completed_retry";
  }
  return "compaction_completed";
}

export function resolvePromptCacheDecisionCodes(params: {
  hasInheritedPromptEnvelope: boolean;
  canReuseParentPrefix: boolean;
  mismatchCount: number;
  skipCacheWrite: boolean;
  cacheRetention?: string | undefined;
  hasCacheIdentity: boolean;
}): DecisionCodeMap {
  return {
    queryLayerCache: params.hasCacheIdentity
      ? "query_layer_cache_identity_ready"
      : "query_layer_cache_identity_missing",
    promptCache: params.skipCacheWrite
      ? "prompt_cache_write_skipped"
      : params.mismatchCount > 0
        ? "prompt_cache_parent_prefix_reset"
        : params.hasInheritedPromptEnvelope && params.canReuseParentPrefix
          ? "prompt_cache_parent_prefix_reused"
          : params.cacheRetention === "none"
            ? "prompt_cache_retention_none"
            : params.cacheRetention === "short"
              ? "prompt_cache_retention_short"
              : params.cacheRetention === "long"
                ? "prompt_cache_retention_long"
                : "prompt_cache_default",
  };
}

export function resolveMemoryRecallDecisionCodes(params: {
  hitReason?: string;
  evictionReason?: string;
  durableRecallSource?: string;
}): DecisionCodeMap {
  return {
    ...(params.hitReason ? { recallHit: params.hitReason } : {}),
    ...(params.evictionReason ? { recallEviction: params.evictionReason } : {}),
    ...(params.durableRecallSource ? { durableRecall: params.durableRecallSource } : {}),
  };
}
