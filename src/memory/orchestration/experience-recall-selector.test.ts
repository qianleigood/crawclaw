import { describe, expect, it } from "vitest";
import type { UnifiedRecallItem } from "../types/orchestration.ts";
import { selectExperienceRecall } from "./experience-recall-selector.ts";

function makeItem(
  overrides: Partial<UnifiedRecallItem> &
    Pick<UnifiedRecallItem, "id" | "source" | "title" | "summary">,
): UnifiedRecallItem {
  return {
    layer: "runtime_signals",
    updatedAt: 0,
    ...overrides,
  };
}

describe("selectExperienceRecall", () => {
  it("filters out non-NotebookLM items and keeps provider-ordered experience recall", () => {
    const result = selectExperienceRecall({
      items: [
        makeItem({
          id: "durable-feedback",
          source: "native_memory",
          title: "Prefer concise answers",
          summary: "Stable user preference",
          layer: "preferences",
          metadata: { tags: ["feedback"] },
        }),
        makeItem({
          id: "experience-procedure",
          source: "graph",
          title: "deployment-security-checklist",
          summary: "Deployments must check secrets and rollback.",
          layer: "sop",
          memoryKind: "procedure",
        }),
        makeItem({
          id: "notebooklm-procedure",
          source: "notebooklm",
          title: "deployment-security-checklist",
          summary: "Deployments must check secrets and rollback.",
          layer: "sop",
          memoryKind: "procedure",
        }),
      ],
    });

    expect(result.selectedItemIds).toEqual(["notebooklm-procedure"]);
    expect(result.omittedItemIds).toEqual(["durable-feedback", "experience-procedure"]);
    expect(result.mode).toBe("provider_order");
  });

  it("keeps NotebookLM order instead of sorting by local retrieval score", () => {
    const result = selectExperienceRecall({
      items: [
        makeItem({
          id: "notebooklm-gemini-first",
          source: "notebooklm",
          title: "Gemini selected this as most applicable",
          summary: "NotebookLM returned this first because it directly answers the current task.",
          layer: "sop",
          memoryKind: "procedure",
          retrievalScore: 0.1,
        }),
        makeItem({
          id: "notebooklm-higher-local-score",
          source: "notebooklm",
          title: "Local score should not win",
          summary: "This has a higher raw score but was returned second by NotebookLM.",
          layer: "sop",
          memoryKind: "procedure",
          retrievalScore: 0.99,
        }),
      ],
    });

    expect(result.selectedItemIds).toEqual([
      "notebooklm-gemini-first",
      "notebooklm-higher-local-score",
    ]);
    expect(result.items.map((item) => item.score)).toEqual([1, 0.999]);
  });

  it("can select more than four provider-ranked experience items when the caller lends budget", () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      makeItem({
        id: `experience-${index + 1}`,
        source: "notebooklm",
        title: `experience ${index + 1}`,
        summary:
          "A strong operational recall item with enough detail to pass prompt-facing filtering.",
        layer: "sop",
        memoryKind: "procedure",
      }),
    );

    const result = selectExperienceRecall({ items, limit: 6 });

    expect(result.selectedItemIds).toHaveLength(6);
  });

  it("skips NotebookLM items without enough prompt-facing content", () => {
    const result = selectExperienceRecall({
      items: [
        makeItem({
          id: "weak-experience",
          source: "notebooklm",
          title: "tmp",
          summary: "too short",
          layer: "sources",
          memoryKind: "reference",
        }),
      ],
    });

    expect(result.items).toEqual([]);
    expect(result.selectedItemIds).toEqual([]);
    expect(result.mode).toBe("none");
  });
});
