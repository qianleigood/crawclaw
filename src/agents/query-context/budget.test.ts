import { describe, expect, it } from "vitest";
import type { ModelContextBudget } from "../context-window-guard.js";
import { compileQueryContextBudget } from "./budget.js";
import type { QueryContext } from "./types.js";

function makeBudget(overrides?: Partial<ModelContextBudget>): ModelContextBudget {
  return {
    windowTokens: 8_000,
    usableInputTokens: 120,
    outputReserveTokens: 1_000,
    providerOverheadTokens: 512,
    toolSchemaTokens: 0,
    memoryBudgetTokens: 400,
    source: "model",
    confidence: "high",
    ...overrides,
  };
}

function repeated(label: string, count: number): string {
  return Array.from({ length: count }, () => label).join(" ");
}

function createContext(): QueryContext {
  return {
    messages: [],
    userPrompt: "ship it",
    userContextSections: [
      {
        id: "user-checklist",
        role: "user_context",
        content: repeated("checklist", 120),
        budget: { priority: "normal", eviction: "truncate", maxTokens: 12 },
      },
    ],
    systemPromptSections: [
      {
        id: "base",
        role: "system_prompt",
        content: repeated("critical-system", 20),
        budget: { priority: "critical", eviction: "drop" },
      },
    ],
    systemContextSections: [
      {
        id: "memory:experience",
        role: "system_context",
        content: repeated("experience", 160),
        sectionType: "experience",
        budget: { priority: "normal", eviction: "drop" },
      },
      {
        id: "hook:low",
        role: "system_context",
        content: repeated("hook", 80),
        source: "hook:test",
        budget: { priority: "low", eviction: "drop" },
      },
    ],
    toolContext: {
      tools: [],
      toolNames: [],
      toolPromptPayload: [],
    },
    thinkingConfig: {},
  };
}

describe("compileQueryContextBudget", () => {
  it("keeps system prompt and current user prompt while pruning structured sections", () => {
    const result = compileQueryContextBudget({
      context: createContext(),
      budget: makeBudget(),
    });

    expect(result.context.systemPromptSections.map((section) => section.id)).toEqual(["base"]);
    expect(result.context.userPrompt).toBe("ship it");
    expect(result.context.systemContextSections.map((section) => section.id)).not.toContain(
      "hook:low",
    );
    expect(result.diagnostics.pruningActions.map((action) => action.sectionId)).toEqual(
      expect.arrayContaining(["hook:low", "memory:experience", "user-checklist"]),
    );
    expect(result.diagnostics.remainingEstimatedTokens).toBeLessThanOrEqual(
      result.diagnostics.usableInputTokens,
    );
  });

  it("does not prune when the section estimate fits the model budget", () => {
    const result = compileQueryContextBudget({
      context: createContext(),
      budget: makeBudget({ usableInputTokens: 2_000 }),
    });

    expect(result.context.systemContextSections.map((section) => section.id)).toEqual([
      "memory:experience",
      "hook:low",
    ]);
    expect(result.diagnostics.pruningActions).toHaveLength(0);
  });

  it("can prune bootstrap system prompt sections without pruning critical system rules", () => {
    const context = createContext();
    const result = compileQueryContextBudget({
      context: {
        ...context,
        systemPromptSections: [
          ...context.systemPromptSections,
          {
            id: "project_context",
            role: "system_prompt",
            content: repeated("bootstrap", 160),
            sectionType: "bootstrap",
            budget: { priority: "low", eviction: "drop" },
          },
        ],
      },
      budget: makeBudget(),
    });

    expect(result.context.systemPromptSections.map((section) => section.id)).toContain("base");
    expect(result.context.systemPromptSections.map((section) => section.id)).not.toContain(
      "project_context",
    );
    expect(result.diagnostics.pruningActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ sectionId: "project_context" })]),
    );
  });
});
