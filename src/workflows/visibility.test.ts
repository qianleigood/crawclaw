import { describe, expect, it } from "vitest";
import type { WorkflowExecutionRecord, WorkflowExecutionStepRecord } from "./types.js";
import {
  buildWorkflowActionVisibilityProjection,
  buildWorkflowCompensationVisibilityProjection,
  buildWorkflowExecutionVisibilityProjection,
  buildWorkflowStepVisibilityProjection,
} from "./visibility.js";

function createStep(
  overrides: Partial<WorkflowExecutionStepRecord> = {},
): WorkflowExecutionStepRecord {
  return {
    stepId: "draft",
    title: "Draft content",
    status: "running",
    updatedAt: 1,
    ...overrides,
  };
}

function createRecord(overrides: Partial<WorkflowExecutionRecord> = {}): WorkflowExecutionRecord {
  return {
    executionId: "exec_123",
    workflowId: "wf_publish_redbook_123",
    workflowName: "Publish Redbook Note",
    status: "running",
    currentStepId: "draft",
    steps: [createStep()],
    startedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("workflow visibility", () => {
  it("builds root workflow projection from record state", () => {
    expect(buildWorkflowExecutionVisibilityProjection(createRecord())).toEqual({
      projectedTitle: "Running workflow: Publish Redbook Note",
      projectedSummary: "Current step: Draft content",
    });
  });

  it("builds failed workflow projection from error state", () => {
    expect(
      buildWorkflowExecutionVisibilityProjection(
        createRecord({
          status: "failed",
          errorMessage: "Remote execution failed",
        }),
      ),
    ).toEqual({
      projectedTitle: "Workflow failed: Publish Redbook Note",
      projectedSummary: "Remote execution failed",
    });
  });

  it("falls back to currentStepId when steps are not loaded", () => {
    expect(
      buildWorkflowExecutionVisibilityProjection(
        createRecord({
          steps: undefined,
          currentStepId: "review",
          status: "waiting_external",
        }),
      ),
    ).toEqual({
      projectedTitle: "Workflow waiting: Publish Redbook Note",
      projectedSummary: "Current step: review",
    });
  });

  it("builds step projection from step status", () => {
    expect(
      buildWorkflowStepVisibilityProjection(
        createStep({
          status: "waiting",
          summary: "Approve publish",
        }),
      ),
    ).toEqual({
      projectedTitle: "Workflow step waiting: Draft content",
      projectedSummary: "Approve publish",
    });
  });

  it("builds compensation projection from compensation state", () => {
    expect(
      buildWorkflowCompensationVisibilityProjection(
        createStep({
          compensationSummary: "Rollback succeeded",
        }),
        "succeeded",
      ),
    ).toEqual({
      projectedTitle: "Workflow compensation completed: Draft content",
      projectedSummary: "Rollback succeeded",
    });
  });

  it("builds workflow action projection from workflow detail", () => {
    expect(
      buildWorkflowActionVisibilityProjection({
        status: "waiting",
        detail: {
          executionId: "exec_123",
          workflowId: "wf_publish_redbook_123",
          workflowName: "Publish Redbook Note",
        },
      }),
    ).toEqual({
      projectedTitle: "Workflow waiting: Publish Redbook Note",
    });
  });

  it("builds workflow action projection from step detail", () => {
    expect(
      buildWorkflowActionVisibilityProjection({
        status: "waiting",
        detail: {
          workflowId: "wf_publish_redbook_123",
          stepId: "review",
          stepTitle: "Review",
          stepStatus: "waiting",
        },
        summary: "Approve publish",
      }),
    ).toEqual({
      projectedTitle: "Workflow step waiting: Review",
      projectedSummary: "Approve publish",
    });
  });
});
