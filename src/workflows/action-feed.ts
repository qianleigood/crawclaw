import { emitAgentActionEvent } from "../agents/action-feed/emit.js";
import { forwardWorkflowActionToChannel } from "./channel-forwarder.js";
import type {
  WorkflowExecutionCompensationStatus,
  WorkflowExecutionRecord,
  WorkflowExecutionStatus,
  WorkflowExecutionStepRecord,
  WorkflowExecutionStepStatus,
} from "./types.js";
import {
  buildWorkflowCompensationVisibilityProjection,
  buildWorkflowExecutionVisibilityProjection,
  buildWorkflowStepVisibilityProjection,
} from "./visibility.js";

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
  const projection = buildWorkflowExecutionVisibilityProjection(record);
  emitWorkflowAction(record, {
    actionId: workflowActionId,
    status: resolveWorkflowActionStatus(record.status),
    title: projection.projectedTitle,
    summary: projection.projectedSummary,
    projectedTitle: projection.projectedTitle,
    projectedSummary: projection.projectedSummary,
  });
}

export function emitWorkflowExecutionStepAction(params: {
  record: WorkflowExecutionRecord;
  step: WorkflowExecutionStepRecord;
}): void {
  const workflowActionId = `workflow:${params.record.executionId}`;
  const projection = buildWorkflowStepVisibilityProjection(params.step, params.step.status);
  emitWorkflowAction(params.record, {
    actionId: `workflow:${params.record.executionId}:step:${params.step.stepId}`,
    parentActionId: workflowActionId,
    status: resolveWorkflowActionStatus(params.step.status),
    title: projection.projectedTitle,
    summary: projection.projectedSummary,
    projectedTitle: projection.projectedTitle,
    projectedSummary: projection.projectedSummary,
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
  const projection = buildWorkflowCompensationVisibilityProjection(params.step, params.status);
  emitWorkflowAction(params.record, {
    actionId: `workflow:${params.record.executionId}:step:${params.step.stepId}:compensation`,
    parentActionId: workflowActionId,
    status: resolveWorkflowActionStatus(params.status),
    title: projection.projectedTitle,
    summary: projection.projectedSummary,
    projectedTitle: projection.projectedTitle,
    projectedSummary: projection.projectedSummary,
    detail: {
      stepId: params.step.stepId,
      stepTitle: params.step.title,
      compensationStatus: params.status,
    },
  });
}
