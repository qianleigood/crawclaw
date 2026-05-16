import { emitAgentActionEvent } from "../agents/action-feed/emit.js";
import type { AgentActionStatus } from "../agents/action-feed/types.js";
import type {
  WorkflowExecutionCompensationStatus,
  WorkflowExecutionRecord,
  WorkflowExecutionStatus,
  WorkflowExecutionStepRecord,
  WorkflowExecutionStepStatus,
} from "./types.js";

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workflow action value: ${String(value)}`);
}

function workflowName(entry: WorkflowExecutionRecord): string {
  return trimOptional(entry.workflowName) ?? entry.workflowId;
}

function stepName(step: WorkflowExecutionStepRecord): string {
  return trimOptional(step.title) ?? step.stepId;
}

function mapWorkflowStatus(status: WorkflowExecutionStatus): AgentActionStatus {
  switch (status) {
    case "queued":
      return "started";
    case "running":
      return "running";
    case "waiting_input":
    case "waiting_external":
      return "waiting";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
  return assertNever(status);
}

function mapStepStatus(
  status: WorkflowExecutionStepStatus | WorkflowExecutionCompensationStatus,
): AgentActionStatus {
  switch (status) {
    case "pending":
      return "started";
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "skipped":
      return "completed";
  }
  return assertNever(status);
}

function workflowTitle(entry: WorkflowExecutionRecord): string {
  const name = workflowName(entry);
  switch (entry.status) {
    case "queued":
      return `Queued workflow: ${name}`;
    case "running":
      return `Running workflow: ${name}`;
    case "waiting_input":
    case "waiting_external":
      return `Workflow waiting: ${name}`;
    case "succeeded":
      return `Completed workflow: ${name}`;
    case "failed":
      return `Workflow failed: ${name}`;
    case "cancelled":
      return `Workflow cancelled: ${name}`;
  }
  return assertNever(entry.status);
}

function stepTitle(step: WorkflowExecutionStepRecord): string {
  const name = stepName(step);
  switch (step.status) {
    case "pending":
      return `Queued workflow step: ${name}`;
    case "running":
      return `Running workflow step: ${name}`;
    case "waiting":
      return `Workflow step waiting: ${name}`;
    case "skipped":
      return `Skipped workflow step: ${name}`;
    case "succeeded":
      return `Completed workflow step: ${name}`;
    case "failed":
      return `Workflow step failed: ${name}`;
    case "cancelled":
      return `Workflow step cancelled: ${name}`;
  }
  return assertNever(step.status);
}

function compensationTitle(
  step: WorkflowExecutionStepRecord,
  status: WorkflowExecutionCompensationStatus,
): string {
  const name = stepName(step);
  switch (status) {
    case "running":
      return `Running workflow compensation: ${name}`;
    case "succeeded":
      return `Completed workflow compensation: ${name}`;
    case "failed":
      return `Workflow compensation failed: ${name}`;
    case "cancelled":
      return `Workflow compensation cancelled: ${name}`;
  }
  return assertNever(status);
}

function currentStepSummary(entry: WorkflowExecutionRecord): string | undefined {
  const current =
    entry.steps?.find((step) => step.stepId === entry.currentStepId) ??
    entry.steps?.find((step) => step.status === "running" || step.status === "waiting");
  return current ? `Current step: ${stepName(current)}` : trimOptional(entry.errorMessage);
}

function emitWorkflowAction(params: {
  record: WorkflowExecutionRecord;
  actionId: string;
  parentActionId?: string;
  status: AgentActionStatus;
  title: string;
  summary?: string;
  detail?: Record<string, unknown>;
}) {
  const runId = trimOptional(params.record.originRunId);
  if (!runId) {
    return;
  }

  emitAgentActionEvent({
    runId,
    ...(trimOptional(params.record.originSessionKey)
      ? { sessionKey: trimOptional(params.record.originSessionKey) }
      : {}),
    ...(trimOptional(params.record.originSessionId)
      ? { sessionId: trimOptional(params.record.originSessionId) }
      : {}),
    ...(trimOptional(params.record.originTaskId)
      ? { taskId: trimOptional(params.record.originTaskId) }
      : {}),
    ...(trimOptional(params.record.originAgentId)
      ? { agentId: trimOptional(params.record.originAgentId) }
      : {}),
    ...(trimOptional(params.record.originParentAgentId)
      ? { parentAgentId: trimOptional(params.record.originParentAgentId) }
      : {}),
    data: {
      actionId: params.actionId,
      ...(params.parentActionId ? { parentActionId: params.parentActionId } : {}),
      kind: "workflow",
      status: params.status,
      title: params.title,
      ...(params.summary ? { summary: params.summary } : {}),
      projectedTitle: params.title,
      ...(params.summary ? { projectedSummary: params.summary } : {}),
      ...(trimOptional(params.record.originToolCallId)
        ? { toolCallId: trimOptional(params.record.originToolCallId) }
        : {}),
      detail: {
        executionId: params.record.executionId,
        workflowId: params.record.workflowId,
        status: params.record.status,
        ...params.detail,
      },
    },
  });
}

export function emitWorkflowExecutionAction(entry: WorkflowExecutionRecord): void {
  emitWorkflowAction({
    record: entry,
    actionId: `workflow:${entry.executionId}`,
    status: mapWorkflowStatus(entry.status),
    title: workflowTitle(entry),
    summary: currentStepSummary(entry),
  });
}

export function emitWorkflowExecutionStepAction(params: {
  record: WorkflowExecutionRecord;
  step: WorkflowExecutionStepRecord;
}): void {
  emitWorkflowAction({
    record: params.record,
    actionId: `workflow:${params.record.executionId}:step:${params.step.stepId}`,
    parentActionId: `workflow:${params.record.executionId}`,
    status: mapStepStatus(params.step.status),
    title: stepTitle(params.step),
    summary: trimOptional(params.step.summary),
    detail: {
      stepId: params.step.stepId,
      stepStatus: params.step.status,
      ...(params.step.executor ? { executor: params.step.executor } : {}),
    },
  });
}

export function emitWorkflowExecutionCompensationAction(params: {
  record: WorkflowExecutionRecord;
  step: WorkflowExecutionStepRecord;
  status: WorkflowExecutionCompensationStatus;
}): void {
  emitWorkflowAction({
    record: params.record,
    actionId: `workflow:${params.record.executionId}:step:${params.step.stepId}:compensation`,
    parentActionId: `workflow:${params.record.executionId}:step:${params.step.stepId}`,
    status: mapStepStatus(params.status),
    title: compensationTitle(params.step, params.status),
    summary: trimOptional(params.step.compensationSummary) ?? trimOptional(params.step.summary),
    detail: {
      stepId: params.step.stepId,
      compensationStatus: params.status,
      ...(params.step.compensationError ? { error: params.step.compensationError } : {}),
    },
  });
}
