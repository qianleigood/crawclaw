import { describe, expect, it } from "vitest";
import {
  resolveCompactionLifecycleDecisionCode,
  resolveMemoryRecallDecisionCodes,
  resolvePromptCacheDecisionCodes,
  resolveProviderLifecycleDecisionCode,
} from "./decision-codes.js";

describe("decision code helpers", () => {
  it("normalizes provider lifecycle phases into decision codes", () => {
    expect(resolveProviderLifecycleDecisionCode({ phase: "provider_request_start" })).toBe(
      "provider_model_selected",
    );
    expect(resolveProviderLifecycleDecisionCode({ phase: "provider_request_stop" })).toBe(
      "provider_request_completed",
    );
    expect(resolveProviderLifecycleDecisionCode({ phase: "provider_request_error" })).toBe(
      "provider_request_failed",
    );
  });

  it("derives compaction lifecycle decision codes from trigger and retry state", () => {
    expect(
      resolveCompactionLifecycleDecisionCode({
        phase: "pre_compact",
        trigger: "auto_compaction",
      }),
    ).toBe("auto_compaction_started");
    expect(
      resolveCompactionLifecycleDecisionCode({
        phase: "post_compact",
        trigger: "manual",
        willRetry: true,
      }),
    ).toBe("compaction_completed_retry");
  });

  it("derives prompt cache and query-layer cache decision codes", () => {
    expect(
      resolvePromptCacheDecisionCodes({
        hasInheritedPromptEnvelope: true,
        canReuseParentPrefix: false,
        mismatchCount: 1,
        skipCacheWrite: false,
        cacheRetention: "short",
        hasCacheIdentity: true,
      }),
    ).toEqual({
      queryLayerCache: "query_layer_cache_identity_ready",
      promptCache: "prompt_cache_parent_prefix_reset",
    });
  });

  it("maps memory recall reasons into unified decision code keys", () => {
    expect(
      resolveMemoryRecallDecisionCodes({
        hitReason: "durable_selected:prefetch_hit",
        evictionReason: "token_budget:knowledge",
        durableRecallSource: "prefetch_hit",
      }),
    ).toEqual({
      recallHit: "durable_selected:prefetch_hit",
      recallEviction: "token_budget:knowledge",
      durableRecall: "prefetch_hit",
    });
  });
});
