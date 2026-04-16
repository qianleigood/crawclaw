import { describe, expect, it } from "vitest";
import {
  buildExecutionVisibilityText,
  normalizeExecutionVisibilityMode,
  projectAcpToolCallEvent,
  resolveExecutionIntent,
  resolveExecutionVisibilityMode,
} from "./execution-visibility.js";

describe("execution visibility", () => {
  it("normalizes visibility mode aliases", () => {
    expect(normalizeExecutionVisibilityMode("on")).toBe("summary");
    expect(normalizeExecutionVisibilityMode("verbose")).toBe("verbose");
    expect(normalizeExecutionVisibilityMode("full")).toBe("full");
    expect(normalizeExecutionVisibilityMode("none")).toBe("off");
  });

  it("forces off when display is disabled", () => {
    expect(
      resolveExecutionVisibilityMode({
        requested: "full",
        shouldDisplay: false,
      }),
    ).toBe("off");
  });

  it("resolves waiting approval intent from context", () => {
    expect(
      resolveExecutionIntent({
        kind: "workflow",
        phase: "waiting",
        message: "Awaiting approval before resuming workflow",
      }),
    ).toEqual({
      intent: "wait_approval",
      confidence: "high",
      source: "context",
    });
  });

  it("falls back to family-based read intent for file work", () => {
    expect(
      resolveExecutionIntent({
        kind: "tool",
        phase: "start",
        sourceName: "List files",
      }),
    ).toEqual({
      intent: "read",
      confidence: "medium",
      source: "family",
    });
  });

  it("renders workflow summary text from workflow metadata", () => {
    expect(
      buildExecutionVisibilityText({
        mode: "summary",
        event: {
          kind: "workflow",
          phase: "start",
          workflow: {
            workflowName: "Publish Redbook",
            stepName: "Draft outline",
          },
        },
      }),
    ).toBe("Workflow: Publish Redbook");
  });

  it("projects ACP tool calls through the semantic layer", () => {
    expect(
      projectAcpToolCallEvent({
        mode: "summary",
        event: {
          type: "tool_call",
          tag: "tool_call",
          toolCallId: "call_1",
          status: "in_progress",
          title: "search docs",
          text: "search docs (in_progress)",
        },
      }),
    ).toBe("Searching search docs");
  });
});
