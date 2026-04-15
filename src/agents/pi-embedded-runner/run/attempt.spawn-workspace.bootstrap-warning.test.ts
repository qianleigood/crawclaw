import { describe, expect, it } from "vitest";
import {
  analyzeBootstrapBudget,
  buildBootstrapInjectionStats,
  buildBootstrapPromptWarning,
  prependBootstrapPromptWarning,
} from "../../bootstrap-budget.js";
import { materializeQueryContext } from "../../query-context/render.js";

describe("runEmbeddedAttempt bootstrap warning prompt assembly", () => {
  it("keeps bootstrap warnings in the sent prompt after hook prepend context", () => {
    const analysis = analyzeBootstrapBudget({
      files: buildBootstrapInjectionStats({
        bootstrapFiles: [
          {
            name: "AGENTS.md",
            path: "/tmp/crawclaw-warning-workspace/AGENTS.md",
            content: "A".repeat(200),
            missing: false,
          },
        ],
        injectedFiles: [{ path: "AGENTS.md", content: "A".repeat(20) }],
      }),
      bootstrapMaxChars: 50,
      bootstrapTotalMaxChars: 50,
    });
    const warning = buildBootstrapPromptWarning({
      analysis,
      mode: "once",
    });
    const modelInput = materializeQueryContext({
      messages: [],
      userPrompt: prependBootstrapPromptWarning("hello", warning.lines),
      userContextSections: [{ id: "hook:prepend", role: "user_context", content: "hook context" }],
      systemPromptSections: [],
      systemContextSections: [],
      toolContext: { tools: [], toolNames: [], toolPromptPayload: [] },
      thinkingConfig: {},
    });

    expect(modelInput.prompt).toContain("hook context");
    expect(modelInput.prompt).toContain("[Bootstrap truncation warning]");
    expect(modelInput.prompt).toContain("- AGENTS.md: 200 raw -> 20 injected");
    expect(modelInput.prompt).toContain("hello");
  });
});
