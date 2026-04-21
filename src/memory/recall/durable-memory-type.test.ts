import { describe, expect, it } from "vitest";
import type { UnifiedRankedItem } from "../types/orchestration.ts";
import { classifyMemoryRecallItem, splitMemoryRecallItems } from "./durable-memory-type.js";

function makeItem(
  overrides: Partial<UnifiedRankedItem> &
    Pick<UnifiedRankedItem, "id" | "source" | "title" | "summary">,
): UnifiedRankedItem {
  return {
    layer: "runtime_signals",
    updatedAt: 0,
    supportingSources: [],
    supportingIds: [],
    score: 0.5,
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
      finalScore: 0.5,
    },
    ...overrides,
  } as UnifiedRankedItem;
}

describe("durable memory taxonomy", () => {
  it("classifies durable memory kinds from tags and layers", () => {
    const cases = [
      {
        item: makeItem({
          id: "user",
          source: "native_memory",
          title: "User profile",
          summary: "User is a senior backend engineer",
          layer: "preferences",
          metadata: { tags: ["user"] },
        }),
        expected: "user",
      },
      {
        item: makeItem({
          id: "feedback",
          source: "native_memory",
          title: "Reply style",
          summary: "Keep replies terse and step-first",
          layer: "preferences",
          metadata: { tags: ["feedback"] },
        }),
        expected: "feedback",
      },
      {
        item: makeItem({
          id: "project",
          source: "notebooklm",
          title: "Release freeze",
          summary: "Merge freeze begins before release cut",
          layer: "key_decisions",
          metadata: { tags: ["project"] },
        }),
        expected: "project",
      },
      {
        item: makeItem({
          id: "reference",
          source: "notebooklm",
          title: "Observability dashboard",
          summary: "Link to the dashboard and docs",
          layer: "sources",
          metadata: { tags: ["reference"] },
        }),
        expected: "reference",
      },
    ] as const;

    for (const testCase of cases) {
      const classification = classifyMemoryRecallItem(testCase.item);
      expect(classification.bucket).toBe("durable");
      expect(classification.durableType).toBe(testCase.expected);
      expect(classification.reasons).toEqual(
        expect.arrayContaining(["bucket=durable", `type=${testCase.expected}`]),
      );
    }
  });

  it("splits durable memories away from knowledge recall", () => {
    const durable = makeItem({
      id: "durable",
      source: "native_memory",
      title: "Project preference",
      summary: "Prefer markdown in project notes",
      layer: "preferences",
      metadata: { tags: ["feedback"] },
    });
    const knowledge = makeItem({
      id: "knowledge",
      source: "graph",
      title: "Deployment checklist",
      summary: "Deploy with a rollback check",
      layer: "sop",
      memoryKind: "procedure",
    });

    const split = splitMemoryRecallItems([durable, knowledge]);

    expect(split.durableItems.map((item) => item.id)).toEqual(["durable"]);
    expect(split.knowledgeItems.map((item) => item.id)).toEqual(["knowledge"]);
  });
});
