import type { AgentMessage, StreamFn } from "@mariozechner/pi-agent-core";
import { createAssistantMessageEventStream, type Context, type Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import type { ModelContextBudget } from "../../context-window-guard.js";
import type { QueryContext } from "../../query-context/types.js";
import { wrapStreamFnWithQueryContextBoundary } from "./attempt.query-context-boundary.js";

const model = {
  api: "openai-completions",
  provider: "openai",
  id: "gpt-test",
} as Model<"openai-completions">;

function repeated(label: string, count: number): string {
  return Array.from({ length: count }, () => label).join(" ");
}

function makeBudget(overrides?: Partial<ModelContextBudget>): ModelContextBudget {
  return {
    windowTokens: 8_000,
    usableInputTokens: 80,
    memoryBudgetTokens: 400,
    outputReserveTokens: 1_000,
    providerOverheadTokens: 512,
    toolSchemaTokens: 0,
    source: "model",
    confidence: "high",
    ...overrides,
  };
}

function makeContext(): QueryContext {
  return {
    messages: [],
    userPrompt: "ship it",
    userContextSections: [],
    systemPromptSections: [
      {
        id: "base",
        role: "system_prompt",
        content: "You are CrawClaw.",
        budget: { priority: "critical", eviction: "drop" },
      },
    ],
    systemContextSections: [
      {
        id: "hook:large",
        role: "system_context",
        content: repeated("hook-context", 200),
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

describe("wrapStreamFnWithQueryContextBoundary", () => {
  it("applies the final context budget before building provider request snapshots", async () => {
    const context = makeContext();
    let nextQueryContext = context;
    let capturedContext: Context | undefined;
    let capturedOptions: unknown;
    const baseStreamFn: StreamFn = (_model, providerContext, options) => {
      capturedContext = providerContext;
      capturedOptions = options;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.end();
      });
      return stream;
    };

    const wrapped = wrapStreamFnWithQueryContextBoundary({
      streamFn: baseStreamFn,
      getQueryContext: () => nextQueryContext,
      getModelContextBudget: () => makeBudget(),
      setQueryContext: (next) => {
        nextQueryContext = next;
      },
    });

    const stream = await Promise.resolve(
      wrapped(
        model,
        { messages: [{ role: "user", content: "hi" } as AgentMessage] } as Context,
        {},
      ),
    );
    for await (const _ of stream) {
      // consume to completion
    }

    expect(nextQueryContext.systemContextSections.map((section) => section.id)).not.toContain(
      "hook:large",
    );
    expect(capturedContext?.systemPrompt).not.toContain("hook-context");
    const metadata = (capturedOptions as { metadata?: Record<string, unknown> }).metadata;
    const queryContextMetadata = metadata?.crawclawQueryContext as
      | { contextBudget?: { pruningActions?: Array<{ sectionId: string }> } }
      | undefined;
    expect(queryContextMetadata?.contextBudget?.pruningActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ sectionId: "hook:large" })]),
    );
  });
});
