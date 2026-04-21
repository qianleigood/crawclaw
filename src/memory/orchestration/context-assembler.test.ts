import { describe, expect, it } from "vitest";
import type {
  DurableMemoryItem,
  UnifiedQueryClassification,
  UnifiedRankedItem,
} from "../types/orchestration.ts";
import { assembleMemoryPrompt } from "./context-assembler.ts";

function makeExperienceItem(
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

function makeClassification(
  intent: UnifiedQueryClassification["intent"],
  targetLayers: UnifiedQueryClassification["targetLayers"],
): UnifiedQueryClassification {
  return {
    query: "query",
    normalizedQuery: "query",
    intent,
    secondaryIntents: [],
    confidence: 0.9,
    keywords: ["query"],
    entityHints: [],
    temporalHints: [],
    routeWeights: {
      graph: 0.25,
      notebooklm: 0.25,
      nativeMemory: 0.25,
      execution: 0.25,
    },
    targetLayers,
    rationale: ["test"],
  };
}

describe("assembleMemoryPrompt", () => {
  it("renders durable and experience sections separately", () => {
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
      experienceItems: [
        makeExperienceItem({
          id: "procedure-memory",
          source: "graph",
          title: "deployment-security-checklist",
          summary: "Deployments must check secrets and rollback.",
          layer: "sop",
          memoryKind: "procedure",
          score: 0.7,
          sourceRef: "gm_skill_1",
        }),
        makeExperienceItem({
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

    expect(assembled.sections.map((section) => section.kind)).toEqual(["durable", "experience"]);
    expect(assembled.text).not.toContain("## Session memory");
    expect(assembled.text).toContain("## Durable memory");
    expect(assembled.text).toContain("## 经验回忆");
    expect(assembled.text).toContain("Feedback memory: Prefer concise answers");
    expect(assembled.text).toContain("Project memory: Memory refactor scope");
    expect(assembled.text).toContain("## 操作经验");
    expect(assembled.text).toContain("【操作经验】deployment-security-checklist 适用场景：");
    expect(assembled.text).toContain("## 决策经验");
    expect(assembled.text).toContain("【决策经验】Use built-in memory runtime 经验结论：");
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
      "experience",
    ]);
    expect(queryContextSections[0]?.schema).toMatchObject({
      kind: "durable_memory",
      itemIds: expect.arrayContaining(["user-memory", "project-memory"]),
      omittedCount: 0,
    });
  });

  it("keeps experience recall inside its total allocated budget across layers", () => {
    const summary =
      "This recall item intentionally has enough detail to make the token estimate meaningful for budget enforcement.";
    const assembled = assembleMemoryPrompt({
      experienceItems: [
        makeExperienceItem({
          id: "decision-1",
          source: "notebooklm",
          title: "Decision one",
          summary,
          layer: "key_decisions",
          memoryKind: "decision",
          score: 0.9,
        }),
        makeExperienceItem({
          id: "sop-1",
          source: "notebooklm",
          title: "Procedure one",
          summary,
          layer: "sop",
          memoryKind: "procedure",
          score: 0.88,
        }),
        makeExperienceItem({
          id: "preference-1",
          source: "notebooklm",
          title: "Preference one",
          summary,
          layer: "preferences",
          memoryKind: "preference",
          score: 0.86,
        }),
        makeExperienceItem({
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

    const experienceSection = assembled.sections.find((section) => section.kind === "experience");
    expect(experienceSection).toBeDefined();
    expect(experienceSection?.estimatedTokens ?? 0).toBeLessThanOrEqual(144);
    expect(assembled.omittedItemIds.length).toBeGreaterThan(0);
  });

  it("allocates more durable budget for durable-heavy queries with strong recall evidence", () => {
    const durableItems = Array.from({ length: 6 }, (_, index) =>
      makeDurableItem({
        id: `durable-${index + 1}`,
        source: "native_memory",
        title: `Durable preference ${index + 1}`,
        summary:
          "This durable item has enough wording to make the section budget meaningful when several memories compete for prompt space.",
        durableKind: "feedback",
        durableReasons: ["bucket=durable", "type=feedback"],
        score: 0.9,
        metadata: {
          scoreBreakdown: {
            header: 1,
            index: 1,
            bodyIndex: 1,
            bodyRerank: 1,
            dreamBoost: 0,
            final: 4,
          },
        },
      }),
    );

    const durableHeavy = assembleMemoryPrompt({
      durableItems,
      experienceItems: [],
      classification: makeClassification("preference", ["preferences"]),
      tokenBudget: 360,
    });
    const experienceHeavy = assembleMemoryPrompt({
      durableItems,
      experienceItems: [],
      classification: makeClassification("sop", ["sop", "runtime_signals"]),
      tokenBudget: 360,
    });

    const durableHeavyCount =
      durableHeavy.sections.find((section) => section.kind === "durable")?.itemIds.length ?? 0;
    const experienceHeavyCount =
      experienceHeavy.sections.find((section) => section.kind === "durable")?.itemIds.length ?? 0;
    expect(durableHeavyCount).toBeGreaterThan(experienceHeavyCount);
  });
});
