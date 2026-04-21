import { describe, expect, it } from "vitest";
import type { UnifiedRankedItem } from "../types/orchestration.ts";
import { selectExperienceRecall } from "./experience-recall-selector.ts";

function makeItem(
  overrides: Partial<UnifiedRankedItem> &
    Pick<UnifiedRankedItem, "id" | "source" | "title" | "summary" | "score">,
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

describe("selectExperienceRecall", () => {
  it("filters out durable memory items and keeps only prompt-facing experience recall", () => {
    const result = selectExperienceRecall({
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
          id: "experience-procedure",
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
    expect(result.omittedItemIds).toEqual(["durable-feedback", "experience-procedure"]);
    expect(result.mode).toBe("heuristic");
  });

  it("accepts local experience index items without pretending they came from notebooklm", () => {
    const result = selectExperienceRecall({
      items: [
        makeItem({
          id: "local-sop",
          source: "local_experience_index",
          title: "gateway recovery",
          summary:
            "When gateway health fails, inspect the port, restart the service, then verify health.",
          layer: "sop",
          memoryKind: "procedure",
          score: 0.79,
        }),
      ],
    });

    expect(result.selectedItemIds).toEqual(["local-sop"]);
    expect(result.mode).toBe("heuristic");
  });

  it("can select more than four strong experience items when the caller lends budget", () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      makeItem({
        id: `experience-${index + 1}`,
        source: "notebooklm",
        title: `experience ${index + 1}`,
        summary:
          "A strong operational recall item with enough detail to pass prompt-facing filtering.",
        layer: "sop",
        memoryKind: "procedure",
        score: 0.9 - index * 0.01,
      }),
    );

    const result = selectExperienceRecall({ items, limit: 6 });

    expect(result.selectedItemIds).toHaveLength(6);
  });

  it("can skip experience recall entirely when notebooklm items are too weak", () => {
    const result = selectExperienceRecall({
      items: [
        makeItem({
          id: "weak-experience",
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
