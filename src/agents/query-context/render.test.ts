import { describe, expect, it } from "vitest";
import {
  applyQueryContextPatch,
  buildQueryContextProviderRequestSnapshot,
  buildQueryContextIdentityHash,
  renderQueryContextSystemPrompt,
  renderQueryContextUserPrompt,
  summarizeQueryContextSectionTokenUsage,
} from "./render.js";
import type { QueryContext } from "./types.js";

function createContext(): QueryContext {
  return {
    messages: [],
    userPrompt: "ship it",
    userContextSections: [],
    systemPromptSections: [
      {
        id: "base",
        role: "system_prompt",
        content: "You are CrawClaw.",
      },
    ],
    systemContextSections: [
      {
        id: "memory",
        role: "system_context",
        content: "## Session memory\nCurrent task: verify.",
        schema: {
          kind: "session_memory",
          itemIds: [],
          omittedCount: 0,
        },
      },
    ],
    toolContext: {
      tools: [],
      toolNames: ["read", "exec"],
      toolPromptPayload: [{ name: "read" }, { name: "exec" }],
    },
    thinkingConfig: {
      thinkLevel: "medium",
    },
  };
}

describe("query context render", () => {
  it("renders system context before base system prompt", () => {
    const rendered = renderQueryContextSystemPrompt(createContext());
    expect(rendered).toContain("## Session memory");
    expect(rendered).toContain("You are CrawClaw.");
    expect(rendered.indexOf("## Session memory")).toBeLessThan(
      rendered.indexOf("You are CrawClaw."),
    );
  });

  it("renders user context before prompt", () => {
    const rendered = renderQueryContextUserPrompt({
      userPrompt: "ship it",
      userContextSections: [
        {
          id: "warning",
          role: "user_context",
          content: "[warning]\nread directly if details are missing",
        },
      ],
    });
    expect(rendered).toBe("[warning]\nread directly if details are missing\n\nship it");
  });

  it("applies structured patches and clears system context on override", () => {
    const patched = applyQueryContextPatch(createContext(), {
      clearSystemContextSections: true,
      replaceSystemPromptSections: [
        {
          id: "override",
          role: "system_prompt",
          content: "You are a verifier.",
        },
      ],
      prependUserContextSections: [
        {
          id: "prepend",
          role: "user_context",
          content: "Use the provided checklist.",
        },
      ],
    });
    expect(patched.systemContextSections).toHaveLength(0);
    expect(renderQueryContextSystemPrompt(patched)).toContain("You are a verifier.");
    expect(renderQueryContextUserPrompt(patched)).toContain("Use the provided checklist.");
  });

  it("builds a stable identity hash from rendered cache-critical sections", () => {
    const left = buildQueryContextIdentityHash(createContext());
    const contextWithDiagnostics: QueryContext = {
      ...createContext(),
      diagnostics: { bootstrapFiles: ["AGENTS.md"] },
    };
    const right = buildQueryContextIdentityHash(contextWithDiagnostics);
    expect(left).toBe(right);
  });

  it("summarizes section token usage and provider-boundary ordering", () => {
    const context: QueryContext = {
      ...createContext(),
      systemContextSections: [
        ...createContext().systemContextSections,
        {
          id: "hook-ctx",
          role: "system_context",
          content: "hook injected context",
          source: "hook:test_hook",
        },
      ],
      diagnostics: {
        hookMutations: [
          {
            hook: "test_hook",
            prependUserContextSections: 0,
            appendUserContextSections: 0,
            prependSystemContextSections: 1,
            appendSystemContextSections: 0,
            replaceSystemPromptSections: 0,
            clearSystemContextSections: false,
            replaceUserPrompt: false,
          },
        ],
      },
    };
    const usage = summarizeQueryContextSectionTokenUsage(context);
    expect(usage.totalEstimatedTokens).toBeGreaterThan(0);
    expect(usage.byRole.system_context).toBeGreaterThan(0);
    expect(usage.byType.session_memory).toBeGreaterThan(0);
    expect(usage.byRolePercent?.system_context ?? 0).toBeGreaterThan(0);
    const snapshot = buildQueryContextProviderRequestSnapshot(context);
    expect(snapshot.queryContextHash).toHaveLength(64);
    expect(snapshot.sectionOrder.map((section) => section.id)).toEqual([
      "memory",
      "hook-ctx",
      "base",
    ]);
    expect(snapshot.sectionTokenUsage.totalEstimatedTokens).toBe(usage.totalEstimatedTokens);
    expect(snapshot.hookSectionDiffs).toEqual([
      expect.objectContaining({
        hook: "test_hook",
        activeSectionIds: {
          system_prompt: [],
          system_context: ["hook-ctx"],
          user_context: [],
        },
      }),
    ]);
  });
});
