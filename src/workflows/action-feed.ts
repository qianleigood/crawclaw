import { emitAgentActionEvent } from "../agents/action-feed/emit.js";
import { forwardWorkflowActionToChannel } from "./channel-forwarder.js";
import type {
  WorkflowExecutionCompensationStatus,
  WorkflowExecutionRecord,
  WorkflowExecutionStatus,
  WorkflowExecutionStepRecord,
  WorkflowExecutionStepStatus,
} from "./types.js";

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveWorkflowRunId(record: WorkflowExecutionRecord): string | undefined {
  return (
    normalizeOptionalString(record.originRunId) ??
    normalizeOptionalString(record.originSessionId) ??
    (normalizeOptionalString(record.originSessionKey)
      ? `workflow:${record.executionId}`
      : undefined)
  );
}

function resolveWorkflowActionStatus(
  status:
    | WorkflowExecutionStatus
    | WorkflowExecutionStepStatus
    | WorkflowExecutionCompensationStatus,
): "started" | "running" | "waiting" | "completed" | "failed" | "cancelled" {
  if (status === "queued" || status === "pending") {
    return "started";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "waiting" || status === "waiting_external" || status === "waiting_input") {
    return "waiting";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "completed";
}

function resolveWorkflowLabel(record: WorkflowExecutionRecord): string {
  return record.workflowName?.trim() || record.workflowId;
}

function resolveStepLabel(step: WorkflowExecutionStepRecord): string {
  return step.title?.trim() || step.summary?.trim() || step.stepId;
}

function buildWorkflowProjectedTitle(record: WorkflowExecutionRecord): string {
  const label = resolveWorkflowLabel(record);
  switch (record.status) {
    case "queued":
      return `Queued workflow: ${label}`;
    case "running":
      return `Running workflow: ${label}`;
    case "waiting_external":
    case "waiting_input":
      return `Workflow waiting: ${label}`;
    case "succeeded":
      return `Workflow completed: ${label}`;
    case "failed":
      return `Workflow failed: ${label}`;
    case "cancelled":
      return `Workflow cancelled: ${label}`;
  }
  return `Workflow: ${label}`;
}

function buildWorkflowProjectedSummary(record: WorkflowExecutionRecord): string | undefined {
  if (record.status === "failed") {
    return normalizeOptionalString(record.errorMessage);
  }
  const currentStep =
    record.steps?.find((step) => step.stepId === record.currentStepId) ??
    record.steps?.find((step) => step.status === "running" || step.status === "waiting");
  if (currentStep) {
    return `Current step: ${resolveStepLabel(currentStep)}`;
  }
  return undefined;
}

function buildWorkflowStepProjectedTitle(
  step: WorkflowExecutionStepRecord,
  status: WorkflowExecutionStepStatus,
): string {
  const label = resolveStepLabel(step);
  switch (status) {
    case "pending":
      return `Queued workflow step: ${label}`;
    case "running":
      return `Running workflow step: ${label}`;
    case "waiting":
      return `Workflow step waiting: ${label}`;
    case "skipped":
      return `Skipped workflow step: ${label}`;
    case "succeeded":
      return `Completed workflow step: ${label}`;
    case "failed":
      return `Workflow step failed: ${label}`;
    case "cancelled":
      return `Workflow step cancelled: ${label}`;
  }
  return `Workflow step: ${label}`;
}

function buildWorkflowStepProjectedSummary(step: WorkflowExecutionStepRecord): string | undefined {
  return (
    normalizeOptionalString(step.error) ??
    normalizeOptionalString(step.skippedReason) ??
    normalizeOptionalString(step.summary)
  );
}

function buildWorkflowCompensationProjectedTitle(
  step: WorkflowExecutionStepRecord,
  status: WorkflowExecutionCompensationStatus,
): string {
  const label = resolveStepLabel(step);
  switch (status) {
    case "running":
      return `Compensating workflow step: ${label}`;
    case "succeeded":
      return `Workflow compensation completed: ${label}`;
    case "failed":
      return `Workflow compensation failed: ${label}`;
    case "cancelled":
      return `Workflow compensation cancelled: ${label}`;
  }
  return `Workflow compensation: ${label}`;
}

function buildWorkflowCompensationProjectedSummary(
  step: WorkflowExecutionStepRecord,
): string | undefined {
  return (
    normalizeOptionalString(step.compensationError) ??
    normalizeOptionalString(step.compensationSummary)
  );
}

function emitWorkflowAction(
  record: WorkflowExecutionRecord,
  data: {
    actionId: string;
    parentActionId?: string;
    status: "started" | "running" | "waiting" | "completed" | "failed" | "cancelled";
    title: string;
    summary?: string;
    projectedTitle: string;
    projectedSummary?: string;
    detail?: Record<string, unknown>;
  },
): void {
  const runId = resolveWorkflowRunId(record);
  if (!runId) {
    return;
  }
  emitAgentActionEvent({
    runId,
    ...(normalizeOptionalString(record.originSessionKey)
      ? { sessionKey: normalizeOptionalString(record.originSessionKey) }
      : {}),
    ...(normalizeOptionalString(record.originSessionId)
      ? { sessionId: normalizeOptionalString(record.originSessionId) }
      : {}),
    ...(normalizeOptionalString(record.originTaskId)
      ? { taskId: normalizeOptionalString(record.originTaskId) }
      : {}),
    ...(normalizeOptionalString(record.originAgentId)
      ? { agentId: normalizeOptionalString(record.originAgentId) }
      : {}),
    ...(normalizeOptionalString(record.originParentAgentId)
      ? { parentAgentId: normalizeOptionalString(record.originParentAgentId) }
      : {}),
    data: {
      actionId: data.actionId,
      ...(data.parentActionId ? { parentActionId: data.parentActionId } : {}),
      kind: "workflow",
      status: data.status,
      title: data.title,
      ...(data.summary ? { summary: data.summary } : {}),
      toolName: "workflow",
      ...(normalizeOptionalString(record.originToolCallId)
        ? { toolCallId: normalizeOptionalString(record.originToolCallId) }
        : {}),
      projectedTitle: data.projectedTitle,
      ...(data.projectedSummary ? { projectedSummary: data.projectedSummary } : {}),
      detail: {
        workflowId: record.workflowId,
        workflowName: record.workflowName,
        executionId: record.executionId,
        n8nExecutionId: record.n8nExecutionId,
        status: record.status,
        ...(record.currentStepId ? { currentStepId: record.currentStepId } : {}),
        ...data.detail,
      },
    },
  });
  void forwardWorkflowActionToChannel({
    record,
    action: {
      actionId: data.actionId,
      ...(data.parentActionId ? { parentActionId: data.parentActionId } : {}),
      status: data.status,
      title: data.title,
      ...(data.summary ? { summary: data.summary } : {}),
      projectedTitle: data.projectedTitle,
      ...(data.projectedSummary ? { projectedSummary: data.projectedSummary } : {}),
      ...(data.detail ? { detail: data.detail } : {}),
    },
  });
}

export function emitWorkflowExecutionAction(record: WorkflowExecutionRecord): void {
  const workflowActionId = `workflow:${record.executionId}`;
  emitWorkflowAction(record, {
    actionId: workflowActionId,
    status: resolveWorkflowActionStatus(record.status),
    title: buildWorkflowProjectedTitle(record),
    summary: buildWorkflowProjectedSummary(record),
    projectedTitle: buildWorkflowProjectedTitle(record),
    projectedSummary: buildWorkflowProjectedSummary(record),
  });
}

export function emitWorkflowExecutionStepAction(params: {
  record: WorkflowExecutionRecord;
  step: WorkflowExecutionStepRecord;
}): void {
  const workflowActionId = `workflow:${params.record.executionId}`;
  emitWorkflowAction(params.record, {
    actionId: `workflow:${params.record.executionId}:step:${params.step.stepId}`,
    parentActionId: workflowActionId,
    status: resolveWorkflowActionStatus(params.step.status),
    title: buildWorkflowStepProjectedTitle(params.step, params.step.status),
    summary: buildWorkflowStepProjectedSummary(params.step),
    projectedTitle: buildWorkflowStepProjectedTitle(params.step, params.step.status),
    projectedSummary: buildWorkflowStepProjectedSummary(params.step),
    detail: {
      stepId: params.step.stepId,
      stepTitle: params.step.title,
      stepStatus: params.step.status,
      executor: params.step.executor,
    },
  });
}

export function emitWorkflowExecutionCompensationAction(params: {
  record: WorkflowExecutionRecord;
  step: WorkflowExecutionStepRecord;
  status: WorkflowExecutionCompensationStatus;
}): void {
  const workflowActionId = `workflow:${params.record.executionId}`;
  emitWorkflowAction(params.record, {
    actionId: `workflow:${params.record.executionId}:step:${params.step.stepId}:compensation`,
    parentActionId: workflowActionId,
    status: resolveWorkflowActionStatus(params.status),
    title: buildWorkflowCompensationProjectedTitle(params.step, params.status),
    summary: buildWorkflowCompensationProjectedSummary(params.step),
    projectedTitle: buildWorkflowCompensationProjectedTitle(params.step, params.status),
    projectedSummary: buildWorkflowCompensationProjectedSummary(params.step),
    detail: {
      stepId: params.step.stepId,
      stepTitle: params.step.title,
      compensationStatus: params.status,
    },
  });
}
