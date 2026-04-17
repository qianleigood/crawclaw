import type {
  WorkflowExecutionCompensationStatus,
  WorkflowExecutionRecord,
  WorkflowExecutionStatus,
  WorkflowExecutionStepRecord,
  WorkflowExecutionStepStatus,
  WorkflowExecutionView,
} from "./types.js";

export type WorkflowVisibilityScope = "workflow" | "step" | "compensation";

export type WorkflowVisibilityProjection = {
  projectedTitle: string;
  projectedSummary?: string;
};

type WorkflowExecutionVisibilitySource =
  | Pick<
      WorkflowExecutionRecord,
      "workflowId" | "workflowName" | "status" | "currentStepId" | "steps" | "errorMessage"
    >
  | (Pick<
      WorkflowExecutionView,
      "workflowId" | "workflowName" | "status" | "currentStepId" | "steps"
    > & {
      errorMessage?: string;
    });

export type WorkflowActionVisibilityStatus =
  | "started"
  | "running"
  | "waiting"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

const WORKFLOW_EXECUTION_STATUSES = new Set([
  "queued",
  "running",
  "waiting_input",
  "waiting_external",
  "succeeded",
  "failed",
  "cancelled",
]);

const WORKFLOW_STEP_STATUSES = new Set([
  "pending",
  "running",
  "waiting",
  "skipped",
  "succeeded",
  "failed",
  "cancelled",
]);

const WORKFLOW_COMPENSATION_STATUSES = new Set(["running", "succeeded", "failed", "cancelled"]);

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveWorkflowLabel(record: WorkflowExecutionVisibilitySource): string {
  return record.workflowName?.trim() || record.workflowId || "workflow";
}

function resolveStepLabel(step: WorkflowExecutionStepRecord): string {
  return step.title?.trim() || step.summary?.trim() || step.stepId;
}

function resolveCurrentStepLabel(record: WorkflowExecutionVisibilitySource): string | undefined {
  const currentStep =
    record.steps?.find((step) => step.stepId === record.currentStepId) ??
    record.steps?.find((step) => step.status === "running" || step.status === "waiting");
  if (currentStep) {
    return resolveStepLabel(currentStep);
  }
  return normalizeOptionalString(record.currentStepId);
}

export function buildWorkflowExecutionVisibilityProjection(
  record: WorkflowExecutionVisibilitySource,
): WorkflowVisibilityProjection {
  const label = resolveWorkflowLabel(record);
  const projectedTitle = (() => {
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
  })();

  const projectedSummary =
    record.status === "failed"
      ? normalizeOptionalString(record.errorMessage)
      : (() => {
          const currentStepLabel = resolveCurrentStepLabel(record);
          return currentStepLabel ? `Current step: ${currentStepLabel}` : undefined;
        })();

  return {
    projectedTitle,
    ...(projectedSummary ? { projectedSummary } : {}),
  };
}

export function buildWorkflowStepVisibilityProjection(
  step: WorkflowExecutionStepRecord,
  status: WorkflowExecutionStepStatus = step.status,
): WorkflowVisibilityProjection {
  const label = resolveStepLabel(step);
  const projectedTitle = (() => {
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
  })();

  const projectedSummary =
    normalizeOptionalString(step.error) ??
    normalizeOptionalString(step.skippedReason) ??
    normalizeOptionalString(step.summary);

  return {
    projectedTitle,
    ...(projectedSummary ? { projectedSummary } : {}),
  };
}

export function buildWorkflowCompensationVisibilityProjection(
  step: WorkflowExecutionStepRecord,
  status: WorkflowExecutionCompensationStatus,
): WorkflowVisibilityProjection {
  const label = resolveStepLabel(step);
  const projectedTitle = (() => {
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
  })();

  const projectedSummary =
    normalizeOptionalString(step.compensationError) ??
    normalizeOptionalString(step.compensationSummary);

  return {
    projectedTitle,
    ...(projectedSummary ? { projectedSummary } : {}),
  };
}

function toWorkflowExecutionStatus(
  status: WorkflowActionVisibilityStatus,
): WorkflowExecutionStatus {
  switch (status) {
    case "started":
      return "queued";
    case "running":
      return "running";
    case "waiting":
    case "blocked":
      return "waiting_external";
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
  return "running";
}

function toWorkflowStepStatus(status: WorkflowActionVisibilityStatus): WorkflowExecutionStepStatus {
  switch (status) {
    case "started":
      return "pending";
    case "running":
      return "running";
    case "waiting":
    case "blocked":
      return "waiting";
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
  return "running";
}

function toWorkflowCompensationStatus(
  status: WorkflowActionVisibilityStatus,
): WorkflowExecutionCompensationStatus {
  switch (status) {
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "started":
    case "running":
    case "waiting":
    case "blocked":
      return "running";
  }
  return "running";
}

export function buildWorkflowActionVisibilityProjection(params: {
  status: WorkflowActionVisibilityStatus;
  detail?: Record<string, unknown>;
  summary?: string;
}): WorkflowVisibilityProjection | undefined {
  const detail = params.detail;
  if (!detail) {
    return undefined;
  }

  const workflowId = normalizeOptionalString(detail.workflowId);
  const workflowName = normalizeOptionalString(detail.workflowName);
  const stepId = normalizeOptionalString(detail.stepId);
  const stepTitle =
    normalizeOptionalString(detail.stepTitle) ?? normalizeOptionalString(detail.stepName);
  const summary = normalizeOptionalString(params.summary);
  const rawCompensationStatus = normalizeOptionalString(detail.compensationStatus);
  const compensationStatus =
    rawCompensationStatus && WORKFLOW_COMPENSATION_STATUSES.has(rawCompensationStatus)
      ? (rawCompensationStatus as WorkflowExecutionCompensationStatus)
      : undefined;

  if (stepId && compensationStatus) {
    return buildWorkflowCompensationVisibilityProjection(
      {
        stepId,
        ...(stepTitle ? { title: stepTitle } : {}),
        status: "running",
        updatedAt: 0,
        ...(summary ? { compensationSummary: summary } : {}),
      },
      compensationStatus ?? toWorkflowCompensationStatus(params.status),
    );
  }

  if (stepId) {
    const rawStepStatus = normalizeOptionalString(detail.stepStatus);
    const stepStatus =
      rawStepStatus && WORKFLOW_STEP_STATUSES.has(rawStepStatus)
        ? (rawStepStatus as WorkflowExecutionStepStatus)
        : undefined;
    return buildWorkflowStepVisibilityProjection(
      {
        stepId,
        ...(stepTitle ? { title: stepTitle } : {}),
        status: toWorkflowStepStatus(params.status),
        updatedAt: 0,
        ...(summary ? { summary } : {}),
      },
      stepStatus ?? toWorkflowStepStatus(params.status),
    );
  }

  if (!workflowId && !workflowName) {
    return undefined;
  }

  const rawWorkflowStatus = normalizeOptionalString(detail.status);
  const workflowStatus =
    rawWorkflowStatus && WORKFLOW_EXECUTION_STATUSES.has(rawWorkflowStatus)
      ? (rawWorkflowStatus as WorkflowExecutionStatus)
      : undefined;

  return buildWorkflowExecutionVisibilityProjection({
    workflowId: workflowId ?? workflowName ?? "workflow",
    ...(workflowName ? { workflowName } : {}),
    status: workflowStatus ?? toWorkflowExecutionStatus(params.status),
    ...(summary && toWorkflowExecutionStatus(params.status) === "failed"
      ? { errorMessage: summary }
      : {}),
  });
}

export const __testing = {
  toWorkflowCompensationStatus,
  toWorkflowExecutionStatus,
  toWorkflowStepStatus,
  normalizeOptionalString,
  resolveCurrentStepLabel,
  resolveStepLabel,
  resolveWorkflowLabel,
};
