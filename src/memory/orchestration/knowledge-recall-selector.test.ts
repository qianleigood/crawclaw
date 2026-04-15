import { describe, expect, it } from "vitest";
import type { UnifiedRankedItem } from "../types/orchestration.ts";
import { selectKnowledgeRecall } from "./knowledge-recall-selector.ts";

function makeItem(
  overrides: Partial<UnifiedRankedItem> & Pick<UnifiedRankedItem, "id" | "source" | "title" | "summary" | "score">,
): UnifiedRankedItem {
  return {
    layer: "runtime_signals",
    updatedAt: 0,
    supportingSources: [],
    supportingIds: [],
    scoreBreakdown: {
      retrieval: 0,
      sourcePrior: 0,
      layerPrior: 0,
      memoryKindPrior: 0,
      entityBoost: 0,
      keywordBoost: 0,
      exactTitleBoost: 0,
      recencyBoost: 0,
      importanceBoost: 0,
      supportBoost: 0,
      lifecycleBoost: 0,
      mediaBoost: 0,
      penalty: 0,
      finalScore: overrides.score,
    },
    ...overrides,
  } as UnifiedRankedItem;
}

describe("selectKnowledgeRecall", () => {
  it("filters out durable memory items and keeps only prompt-facing knowledge recall", () => {
    const result = selectKnowledgeRecall({
      items: [
        makeItem({
          id: "durable-feedback",
          source: "native_memory",
          title: "Prefer concise answers",
          summary: "Stable user preference",
          layer: "preferences",
          score: 0.9,
          metadata: { tags: ["feedback"] },
        }),
        makeItem({
          id: "knowledge-procedure",
          source: "graph",
          title: "deployment-security-checklist",
          summary: "Deployments must check secrets and rollback.",
          layer: "sop",
          memoryKind: "procedure",
          score: 0.8,
        }),
        makeItem({
          id: "notebooklm-procedure",
          source: "notebooklm",
          title: "deployment-security-checklist",
          summary: "Deployments must check secrets and rollback.",
          layer: "sop",
          memoryKind: "procedure",
          score: 0.78,
        }),
      ],
    });

    expect(result.selectedItemIds).toEqual(["notebooklm-procedure"]);
    expect(result.omittedItemIds).toEqual(["durable-feedback", "knowledge-procedure"]);
    expect(result.mode).toBe("heuristic");
  });

  it("can skip knowledge recall entirely when notebooklm items are too weak", () => {
    const result = selectKnowledgeRecall({
      items: [
        makeItem({
          id: "weak-knowledge",
          source: "notebooklm",
          title: "tmp",
          summary: "too short",
          layer: "sources",
          memoryKind: "reference",
          score: 0.21,
        }),
      ],
    });

    expect(result.items).toEqual([]);
    expect(result.selectedItemIds).toEqual([]);
    expect(result.mode).toBe("none");
  });
});
