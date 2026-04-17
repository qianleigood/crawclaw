import { describe, expect, it, vi } from "vitest";
import { emitSpecialAgentActionEvent } from "./action-feed.js";

describe("special agent action feed", () => {
  it("emits normalized action payloads", () => {
    const emitAgentActionEvent = vi.fn();

    emitSpecialAgentActionEvent({
      emitAgentActionEvent,
      runId: "run-1",
      actionId: "action-1",
      kind: "memory",
      sessionKey: "  session-1  ",
      agentId: "  agent-1  ",
      status: "running",
      title: "Memory extraction running",
      summary: "  scope-1  ",
      projectedTitle: " Memory extraction running ",
      projectedSummary: " scope-1 ",
      detail: { childRunId: "child-1" },
    });

    expect(emitAgentActionEvent).toHaveBeenCalledWith({
      runId: "run-1",
      sessionKey: "session-1",
      agentId: "agent-1",
      data: {
        actionId: "action-1",
        kind: "memory",
        status: "running",
        title: "Memory extraction running",
        summary: "scope-1",
        projectedTitle: "Memory extraction running",
        projectedSummary: "scope-1",
        detail: { childRunId: "child-1" },
      },
    });
  });

  it("omits empty optional metadata", () => {
    const emitAgentActionEvent = vi.fn();

    emitSpecialAgentActionEvent({
      emitAgentActionEvent,
      runId: "run-2",
      actionId: "action-2",
      kind: "memory",
      status: "failed",
      title: "Dream failed",
      summary: "   ",
    });

    expect(emitAgentActionEvent).toHaveBeenCalledWith({
      runId: "run-2",
      data: {
        actionId: "action-2",
        kind: "memory",
        status: "failed",
        title: "Dream failed",
      },
    });
  });
});
