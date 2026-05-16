import { describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "./agent-types.js";
import { applyGoogleTurnOrderingFix } from "./runtime-support.js";
import { castAgentMessage } from "./test-helpers/agent-message-fixtures.js";
import { createInMemorySessionManager } from "./test-helpers/in-memory-session-manager.js";

describe("applyGoogleTurnOrderingFix", () => {
  const makeAssistantFirst = (): AgentMessage[] => [
    castAgentMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "call_1", name: "exec", arguments: {} }],
    }),
  ];

  it("prepends a bootstrap once and records a marker for Google models", () => {
    const sessionManager = createInMemorySessionManager();
    const warn = vi.fn();
    const input = makeAssistantFirst();
    const first = applyGoogleTurnOrderingFix({
      messages: input,
      modelApi: "google-generative-ai",
      sessionManager,
      sessionId: "session:1",
      warn,
    });
    expect(first.messages[0]?.role).toBe("user");
    expect(first.messages[1]?.role).toBe("assistant");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(
      sessionManager
        .getEntries()
        .some(
          (entry) =>
            entry.type === "custom" && entry.customType === "google-turn-ordering-bootstrap",
        ),
    ).toBe(true);

    applyGoogleTurnOrderingFix({
      messages: input,
      modelApi: "google-generative-ai",
      sessionManager,
      sessionId: "session:1",
      warn,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("skips non-Google models", () => {
    const sessionManager = createInMemorySessionManager();
    const warn = vi.fn();
    const input = makeAssistantFirst();
    const result = applyGoogleTurnOrderingFix({
      messages: input,
      modelApi: "openai",
      sessionManager,
      sessionId: "session:2",
      warn,
    });
    expect(result.messages).toBe(input);
    expect(warn).not.toHaveBeenCalled();
  });
});
