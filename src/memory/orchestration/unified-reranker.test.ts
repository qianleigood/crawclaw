import { describe, expect, it } from "vitest";
import type { UnifiedRecallItem } from "../types/orchestration.ts";
import { rerankUnifiedResults } from "./unified-reranker.ts";

function makeItem(overrides: Partial<UnifiedRecallItem> & Pick<UnifiedRecallItem, "id" | "source" | "title" | "summary">): UnifiedRecallItem {
  return {
    layer: "runtime_signals",
    retrievalScore: 0.55,
    importance: 0.4,
    ...overrides,
  };
}

describe("rerankUnifiedResults", () => {
  it("prefers procedure memories for SOP intent", () => {
    const result = rerankUnifiedResults({
      query: "如何安全部署服务",
      classification: {
        query: "如何安全部署服务",
        normalizedQuery: "如何安全部署服务",
        intent: "sop",
        secondaryIntents: [],
        confidence: 0.9,
        keywords: ["部署", "服务"],
        entityHints: [],
        temporalHints: [],
        routeWeights: { graph: 0.25, notebooklm: 0.25, nativeMemory: 0.25, execution: 0.25 },
        targetLayers: ["sop", "sources"],
        rationale: [],
      },
      graphItems: [
        makeItem({
          id: "decision",
          source: "graph",
          title: "为什么保留旧发布流程",
          summary: "旧流程保留是为了历史兼容。",
          layer: "key_decisions",
          memoryKind: "decision",
        }),
        makeItem({
          id: "procedure",
          source: "graph",
          title: "deployment-security-checklist",
          summary: "部署前先检查密钥、回滚和健康检查。",
          layer: "sop",
          memoryKind: "procedure",
        }),
      ],
      limit: 2,
    });

    expect(result.items[0]?.id).toBe("procedure");
    expect(result.items[0]?.scoreBreakdown.memoryKindPrior).toBeGreaterThan(result.items[1]?.scoreBreakdown.memoryKindPrior ?? 0);
  });
});
