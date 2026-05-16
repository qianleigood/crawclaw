import { describe, expect, it } from "vitest";
import {
  buildExecutionVisibilityText,
  buildToolExecutionVisibilityText,
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
    ).toBe("Running workflow: Publish Redbook");
  });

  it("renders workflow waiting summaries through shared workflow visibility", () => {
    expect(
      buildExecutionVisibilityText({
        mode: "summary",
        event: {
          kind: "workflow",
          phase: "waiting",
          workflow: {
            workflowName: "Publish Redbook",
            stepName: "Review draft",
          },
        },
      }),
    ).toBe("Workflow waiting: Publish Redbook");
  });

  it("renders workflow summary text without workflow metadata through shared phase-aware fallback", () => {
    expect(
      buildExecutionVisibilityText({
        mode: "summary",
        event: {
          kind: "workflow",
          phase: "start",
          object: "Publish Redbook",
        },
      }),
    ).toBe("Running workflow: Publish Redbook");
  });

  it("renders workflow failure summaries through shared workflow visibility", () => {
    expect(
      buildExecutionVisibilityText({
        mode: "summary",
        event: {
          kind: "workflow",
          phase: "error",
          detail: "Approval rejected",
          workflow: {
            workflowName: "Publish Redbook",
          },
        },
      }),
    ).toBe("Workflow failed: Publish Redbook");
  });

  it("projects workflow tool summaries through shared workflow visibility", () => {
    expect(
      buildToolExecutionVisibilityText({
        toolName: "workflow",
        meta: "Publish Redbook",
        phase: "waiting",
        mode: "summary",
      }),
    ).toBe("Workflow waiting: Publish Redbook");
  });

  it("projects CrawClaw tool args through the shared tool display layer", () => {
    expect(
      buildToolExecutionVisibilityText({
        toolName: "read",
        args: { path: "package.json" },
        phase: "error",
        mode: "summary",
        status: "failed",
      }),
    ).toBe("Read failed: from package.json");
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

  it("projects ACP workflow tool calls through shared workflow visibility in summary mode", () => {
    expect(
      projectAcpToolCallEvent({
        mode: "summary",
        event: {
          type: "tool_call",
          tag: "tool_call",
          toolCallId: "call_workflow_1",
          status: "in_progress",
          title: "workflow publish draft",
          text: "workflow publish draft (in_progress)",
        },
      }),
    ).toBe("Running workflow: workflow publish draft");
  });

  it("keeps ACP workflow tool calls detailed in full mode", () => {
    expect(
      projectAcpToolCallEvent({
        mode: "full",
        event: {
          type: "tool_call",
          tag: "tool_call",
          toolCallId: "call_workflow_full_1",
          status: "completed",
          title: "workflow publish draft",
          text: "workflow publish draft (completed)",
        },
      }),
    ).toBe("Workflow: workflow publish draft · status=completed");
  });
});
