import { describe, expect, it } from "vitest";
import type { UnifiedRankedItem } from "../types/orchestration.ts";
import { selectDurableMemories } from "./durable-memory-selector.js";

function makeItem(overrides: Partial<UnifiedRankedItem> & Pick<UnifiedRankedItem, "id" | "source" | "title" | "summary" | "score">): UnifiedRankedItem {
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

describe("selectDurableMemories", () => {
  it("classifies feedback-like durable memories separately from knowledge recall", () => {
    const result = selectDurableMemories({
      items: [
        makeItem({
          id: "feedback-1",
          source: "native_memory",
          title: "Keep responses terse",
          summary: "User prefers terse replies with no trailing summary",
          layer: "preferences",
          score: 0.61,
          metadata: { tags: ["feedback"] },
        }),
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.selectedItemIds).toEqual(["feedback-1"]);
    expect(result.items[0]?.reasons).toEqual(expect.arrayContaining(["bucket=durable", "type=feedback", "matched=feedback"]));
  });

  it("prefers explicit priority over score and recency", () => {
    const result = selectDurableMemories({
      items: [
        makeItem({
          id: "low-score-high-priority",
          source: "notebooklm",
          title: "Workspace default",
          summary: "Keep the workspace default",
          layer: "preferences",
          score: 0.2,
          updatedAt: 10,
          metadata: { priority: 0.9, tags: ["feedback"] },
        }),
        makeItem({
          id: "high-score-no-priority",
          source: "native_memory",
          title: "Project freeze",
          summary: "Merge freeze begins before release cut",
          layer: "key_decisions",
          score: 0.95,
          updatedAt: 1000,
          metadata: { tags: ["project"] },
        }),
      ],
    });

    expect(result.selectedItemIds).toEqual(["low-score-high-priority", "high-score-no-priority"]);
    expect(result.items[0]?.prioritySource).toBe("explicit");
  });

  it("limits durable memories and excludes knowledge recall items", () => {
    const result = selectDurableMemories({
      limit: 2,
      items: [
        makeItem({
          id: "user-1",
          source: "native_memory",
          title: "User profile",
          summary: "User is a senior backend engineer new to React",
          layer: "preferences",
          score: 0.7,
          importance: 0.8,
          metadata: { tags: ["user"] },
        }),
        makeItem({
          id: "project-1",
          source: "notebooklm",
          title: "Release freeze",
          summary: "Project enters merge freeze on 2026-04-10",
          layer: "key_decisions",
          score: 0.68,
          importance: 0.7,
          metadata: { tags: ["project"] },
        }),
        makeItem({
          id: "procedure-1",
          source: "graph",
          title: "Runbook step",
          summary: "Procedure memory",
          layer: "sop",
          score: 0.66,
          importance: 0.6,
          memoryKind: "procedure",
        }),
        makeItem({
          id: "source-only",
          source: "notebooklm",
          title: "Source record",
          summary: "Should be excluded by the durable selector",
          layer: "sources",
          score: 0.99,
        }),
      ],
    });

    expect(result.items).toHaveLength(2);
    expect(result.selectedItemIds).toEqual(["user-1", "project-1"]);
    expect(result.omittedItemIds).toEqual(expect.arrayContaining(["procedure-1", "source-only"]));
  });
});
