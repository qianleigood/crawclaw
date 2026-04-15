import type { N8nExecutionRecord } from "./n8n-client.js";
import type {
  WorkflowExecutionExecutor,
  WorkflowExecutionRecord,
  WorkflowExecutionStatus,
  WorkflowExecutionView,
  WorkflowExecutionWaitState,
} from "./types.js";

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findStringByKey(
  value: unknown,
  key: string,
  depth = 0,
  seen = new Set<unknown>(),
): string | undefined {
  if (depth > 6 || value == null || seen.has(value)) {
    return undefined;
  }
  if (typeof value === "string") {
    return undefined;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStringByKey(entry, key, depth + 1, seen);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  for (const entry of Object.values(record)) {
    const found = findStringByKey(entry, key, depth + 1, seen);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function getN8nExecutionId(remote: N8nExecutionRecord | null | undefined): string | undefined {
  const candidate = remote?.executionId ?? remote?.id;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

export function getN8nExecutionStatus(
  remote: N8nExecutionRecord | null | undefined,
): string | undefined {
  return typeof remote?.status === "string" && remote.status.trim() ? remote.status.trim() : undefined;
}

export function extractN8nResumeUrl(
  remote: N8nExecutionRecord | null | undefined,
  n8nBaseUrl?: string,
): string | undefined {
  const explicit = findStringByKey(remote?.data, "resumeUrl") ?? findStringByKey(remote, "resumeUrl");
  if (explicit) {
    return explicit;
  }
  const resumeToken = findStringByKey(remote?.data, "resumeToken");
  const executionId = getN8nExecutionId(remote);
  if (!resumeToken || !executionId || !n8nBaseUrl?.trim()) {
    return undefined;
  }
  const base = `${n8nBaseUrl.replace(/\/+$/, "")}/webhook-waiting/${encodeURIComponent(executionId)}`;
  const url = new URL(base);
  url.searchParams.set("signature", resumeToken);
  return url.toString();
}

export function mapN8nExecutionStatus(
  remote: N8nExecutionRecord | null | undefined,
): WorkflowExecutionStatus {
  const status = getN8nExecutionStatus(remote)?.toLowerCase();
  if (status === "success" || status === "succeeded" || status === "completed") {
    return "succeeded";
  }
  if (status === "error" || status === "failed" || status === "crashed") {
    return "failed";
  }
  if (status === "canceled" || status === "cancelled" || status === "stopped") {
    return "cancelled";
  }
  if (status === "waiting" || status === "paused") {
    return "waiting_external";
  }
  if (status === "queued" || status === "new" || status === "pending") {
    return "queued";
  }
  if (status === "running") {
    return "running";
  }
  if (remote?.finished === true) {
    return "succeeded";
  }
  if (remote?.stoppedAt) {
    return "cancelled";
  }
  return "running";
}

function inferExecutor(
  local: WorkflowExecutionRecord | null | undefined,
  remote: N8nExecutionRecord | null | undefined,
  status: WorkflowExecutionStatus,
): WorkflowExecutionExecutor | undefined {
  if (local?.currentExecutor) {
    return local.currentExecutor;
  }
  if (status === "waiting_external" || status === "waiting_input") {
    return "n8n_wait";
  }
  if (remote) {
    return "n8n";
  }
  return undefined;
}

function inferWaitingState(
  local: WorkflowExecutionRecord | null | undefined,
  remote: N8nExecutionRecord | null | undefined,
  status: WorkflowExecutionStatus,
  n8nBaseUrl?: string,
): WorkflowExecutionWaitState | undefined {
  if (status !== "waiting_input" && status !== "waiting_external") {
    return undefined;
  }
  const activeStep =
    local?.steps?.find((step) => step.stepId === local.currentStepId) ??
    local?.steps?.find((step) => step.status === "waiting") ??
    undefined;
  const resumeUrl = extractN8nResumeUrl(remote, n8nBaseUrl);
  return {
    kind: status === "waiting_input" ? "input" : "external",
    ...(activeStep?.summary ? { prompt: activeStep.summary } : {}),
    ...(resumeUrl ? { resumeUrl } : {}),
    canResume: Boolean(resumeUrl),
  };
}

export function buildWorkflowExecutionView(params: {
  local?: WorkflowExecutionRecord | null;
  remote?: N8nExecutionRecord | null;
  n8nBaseUrl?: string;
}): WorkflowExecutionView {
  const local = params.local ?? null;
  const remote = params.remote ?? null;
  const remoteExecutionId = getN8nExecutionId(remote);
  const resolvedN8nExecutionId = remoteExecutionId ?? local?.n8nExecutionId;
  const status = remote ? mapN8nExecutionStatus(remote) : (local?.status ?? "queued");
  const isTerminal = status === "succeeded" || status === "failed" || status === "cancelled";
  const endedAt =
    local?.endedAt ??
    (isTerminal
      ? parseTimestamp(remote?.stoppedAt) ?? Date.now()
      : undefined);

  return {
    executionId: local?.executionId ?? remoteExecutionId ?? "unknown",
    ...(local?.executionId ? { localExecutionId: local.executionId } : {}),
    ...(local?.workflowId ? { workflowId: local.workflowId } : {}),
    ...(local?.workflowName ? { workflowName: local.workflowName } : {}),
    ...(local?.n8nWorkflowId ? { n8nWorkflowId: local.n8nWorkflowId } : {}),
    ...(resolvedN8nExecutionId ? { n8nExecutionId: resolvedN8nExecutionId } : {}),
    status,
    ...(local?.currentStepId ? { currentStepId: local.currentStepId } : {}),
    ...(inferExecutor(local, remote, status) ? { currentExecutor: inferExecutor(local, remote, status) } : {}),
    ...(getN8nExecutionStatus(remote) ? { remoteStatus: getN8nExecutionStatus(remote) } : {}),
    ...(typeof remote?.finished === "boolean" ? { remoteFinished: remote.finished } : {}),
    ...(local?.startedAt ?? parseTimestamp(remote?.startedAt)
      ? { startedAt: local?.startedAt ?? parseTimestamp(remote?.startedAt) }
      : {}),
    ...(local?.updatedAt ? { updatedAt: local.updatedAt } : { updatedAt: Date.now() }),
    ...(endedAt ? { endedAt } : {}),
    ...(local?.steps?.length ? { steps: local.steps } : {}),
    ...(local?.events?.length ? { events: local.events } : {}),
    ...(inferWaitingState(local, remote, status, params.n8nBaseUrl)
      ? { waiting: inferWaitingState(local, remote, status, params.n8nBaseUrl) }
      : {}),
    source: local && (remote || local.n8nExecutionId) ? "local+n8n" : local ? "local" : "n8n",
  };
}
