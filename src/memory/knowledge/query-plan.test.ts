import { describe, expect, it } from "vitest";
import { classifyUnifiedQuery } from "../orchestration/query-classifier.js";
import { buildKnowledgeQueryPlan } from "./query-plan.js";

describe("buildKnowledgeQueryPlan", () => {
  it("skips NotebookLM for preference-like queries", () => {
    const classification = classifyUnifiedQuery({
      query: "以后默认回答短一点，这是我的偏好",
    });

    const plan = buildKnowledgeQueryPlan({
      query: classification.query,
      classification,
      defaultLimit: 5,
    });

    expect(plan.enabled).toBe(false);
    expect(plan.limit).toBe(0);
    expect(plan.reason).toBe("preference_prefers_durable_memory");
  });

  it("raises the search limit for SOP queries", () => {
    const classification = classifyUnifiedQuery({
      query: "本地网关挂了怎么恢复？给我操作流程",
    });

    const plan = buildKnowledgeQueryPlan({
      query: classification.query,
      classification,
      defaultLimit: 5,
    });

    expect(plan.enabled).toBe(true);
    expect(plan.limit).toBeGreaterThan(5);
    expect(plan.targetLayers).toContain("sop");
    expect(plan.reason).toBe("intent:sop");
  });
});
