import { describe, expect, it } from "vitest";
import type { DurableMemoryItem, UnifiedRankedItem } from "../types/orchestration.ts";
import { assembleMemoryPrompt } from "./context-assembler.ts";

function makeKnowledgeItem(
  overrides: Partial<UnifiedRankedItem> &
    Pick<UnifiedRankedItem, "id" | "source" | "title" | "summary" | "score">,
): UnifiedRankedItem {
  return {
    layer: "runtime_signals",
    memoryKind: "runtime_pattern",
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

function makeDurableItem(
  overrides: Partial<DurableMemoryItem> &
    Pick<
      DurableMemoryItem,
      "id" | "source" | "title" | "summary" | "score" | "durableKind" | "durableReasons"
    >,
): DurableMemoryItem {
  return {
    layer: "preferences",
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
  } as DurableMemoryItem;
}

describe("assembleMemoryPrompt", () => {
  it("renders durable and knowledge sections separately", () => {
    const assembled = assembleMemoryPrompt({
      durableItems: [
        makeDurableItem({
          id: "user-memory",
          source: "native_memory",
          title: "Prefer concise answers",
          summary: "Keep answers short for this user.",
          durableKind: "feedback",
          durableReasons: ["bucket=durable", "type=feedback"],
          score: 0.9,
        }),
        makeDurableItem({
          id: "project-memory",
          source: "notebooklm",
          title: "Memory refactor scope",
          summary: "This project is a memory prompt refactor.",
          durableKind: "project",
          durableReasons: ["bucket=durable", "type=project"],
          score: 0.8,
        }),
      ],
      knowledgeItems: [
        makeKnowledgeItem({
          id: "procedure-memory",
          source: "graph",
          title: "deployment-security-checklist",
          summary: "Deployments must check secrets and rollback.",
          layer: "sop",
          memoryKind: "procedure",
          score: 0.7,
          sourceRef: "gm_skill_1",
        }),
        makeKnowledgeItem({
          id: "decision-memory",
          source: "graph",
          title: "Use built-in memory runtime",
          summary: "The host should prefer built-in memory runtime.",
          layer: "key_decisions",
          memoryKind: "decision",
          score: 0.68,
          sourceRef: "gm_decision_1",
        }),
      ],
      tokenBudget: 600,
    });

    expect(assembled.sections.map((section) => section.kind)).toEqual(["durable", "knowledge"]);
    expect(assembled.text).not.toContain("## Session memory");
    expect(assembled.text).toContain("## Durable memory");
    expect(assembled.text).toContain("## 知识回忆");
    expect(assembled.text).toContain("Feedback memory: Prefer concise answers");
    expect(assembled.text).toContain("Project memory: Memory refactor scope");
    expect(assembled.text).toContain("## 操作流程");
    expect(assembled.text).toContain("【操作流程】deployment-security-checklist 适用场景：");
    expect(assembled.text).toContain("## 决策说明");
    expect(assembled.text).toContain("【决策说明】Use built-in memory runtime 结论：");
    expect(assembled.selectedItemIds).toEqual(
      expect.arrayContaining([
        "user-memory",
        "project-memory",
        "procedure-memory",
        "decision-memory",
      ]),
    );
    const queryContextSections = assembled.queryContextSections ?? [];
    expect(queryContextSections.map((section) => section.schema?.kind)).toEqual([
      "durable_memory",
      "knowledge",
    ]);
    expect(queryContextSections[0]?.schema).toMatchObject({
      kind: "durable_memory",
      itemIds: expect.arrayContaining(["user-memory", "project-memory"]),
      omittedCount: 0,
    });
  });

  it("keeps knowledge recall inside its total allocated budget across layers", () => {
    const summary =
      "This recall item intentionally has enough detail to make the token estimate meaningful for budget enforcement.";
    const assembled = assembleMemoryPrompt({
      knowledgeItems: [
        makeKnowledgeItem({
          id: "decision-1",
          source: "notebooklm",
          title: "Decision one",
          summary,
          layer: "key_decisions",
          memoryKind: "decision",
          score: 0.9,
        }),
        makeKnowledgeItem({
          id: "sop-1",
          source: "notebooklm",
          title: "Procedure one",
          summary,
          layer: "sop",
          memoryKind: "procedure",
          score: 0.88,
        }),
        makeKnowledgeItem({
          id: "preference-1",
          source: "notebooklm",
          title: "Preference one",
          summary,
          layer: "preferences",
          memoryKind: "preference",
          score: 0.86,
        }),
        makeKnowledgeItem({
          id: "signal-1",
          source: "notebooklm",
          title: "Signal one",
          summary,
          layer: "runtime_signals",
          memoryKind: "runtime_pattern",
          score: 0.84,
        }),
      ],
      tokenBudget: 240,
    });

    const knowledgeSection = assembled.sections.find((section) => section.kind === "knowledge");
    expect(knowledgeSection).toBeDefined();
    expect(knowledgeSection?.estimatedTokens ?? 0).toBeLessThanOrEqual(144);
    expect(assembled.omittedItemIds.length).toBeGreaterThan(0);
  });
});
