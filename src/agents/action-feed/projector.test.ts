import { describe, expect, it } from "vitest";
import { projectAgentActionEventData } from "./projector.js";

describe("projectAgentActionEventData", () => {
  it("uses shared approval visibility for exec approval waiting actions", () => {
    const projected = projectAgentActionEventData({
      version: 1,
      actionId: "approval:exec-1",
      kind: "approval",
      status: "waiting",
      title: "raw approval title",
      summary: "pnpm test auth",
      detail: {
        kind: "exec",
      },
    });

    expect(projected).toMatchObject({
      kind: "approval",
      projectedTitle: "Waiting for exec approval",
      projectedSummary: "pnpm test auth",
    });
  });

  it("uses shared approval visibility for no-route blocked actions", () => {
    const projected = projectAgentActionEventData({
      version: 1,
      actionId: "approval:plugin-1",
      kind: "approval",
      status: "blocked",
      title: "raw approval unavailable",
      summary: "no-approval-route",
      detail: {
        kind: "plugin",
        reason: "no-approval-route",
      },
    });

    expect(projected).toMatchObject({
      kind: "approval",
      projectedTitle: "Approval unavailable",
    });
    expect(projected.projectedSummary).toBeUndefined();
  });

  it("uses shared completion visibility for waiting completion actions", () => {
    const projected = projectAgentActionEventData({
      version: 1,
      actionId: "completion:run-1",
      kind: "completion",
      status: "waiting",
      title: "raw completion title",
      summary: "Task is waiting for explicit user confirmation before it can be completed.",
      detail: {
        completionStatus: "waiting_user",
      },
    });

    expect(projected).toMatchObject({
      kind: "completion",
      projectedTitle: "Waiting for user confirmation",
      projectedSummary:
        "Task is waiting for explicit user confirmation before it can be completed.",
    });
  });

  it("uses shared workflow visibility for workflow detail fallback", () => {
    const projected = projectAgentActionEventData({
      version: 1,
      actionId: "workflow:exec_123",
      kind: "workflow",
      status: "waiting",
      title: "Running workflow",
      summary: "raw summary",
      detail: {
        executionId: "exec_123",
        workflowId: "wf_publish_redbook_123",
        workflowName: "Publish Redbook Note",
      },
    });

    expect(projected).toMatchObject({
      kind: "workflow",
      projectedTitle: "Workflow waiting: Publish Redbook Note",
    });
  });

  it("uses shared workflow visibility for workflow step fallback", () => {
    const projected = projectAgentActionEventData({
      version: 1,
      actionId: "workflow:exec_123:step:review",
      kind: "workflow",
      status: "waiting",
      title: "Running workflow step",
      summary: "Approve publish",
      detail: {
        workflowId: "wf_publish_redbook_123",
        stepId: "review",
        stepTitle: "Review",
        stepStatus: "waiting",
      },
    });

    expect(projected).toMatchObject({
      kind: "workflow",
      projectedTitle: "Workflow step waiting: Review",
      projectedSummary: "Approve publish",
    });
  });

  it("uses shared memory visibility for memory detail fallback", () => {
    const projected = projectAgentActionEventData({
      version: 1,
      actionId: "memory-extraction:session-1:2",
      kind: "memory",
      status: "completed",
      title: "raw memory title",
      summary: "saved one durable note",
      detail: {
        memoryKind: "extraction",
        memoryPhase: "final",
        memoryResultStatus: "written",
      },
    });

    expect(projected).toMatchObject({
      kind: "memory",
      projectedTitle: "Memory extraction wrote durable notes",
      projectedSummary: "saved one durable note",
    });
  });
});
