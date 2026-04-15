import { randomUUID } from "node:crypto";
import type { N8nExecutionRecord } from "./n8n-client.js";
import { buildWorkflowStepNodeName } from "./n8n-compiler.js";
import { getN8nExecutionId, getN8nExecutionStatus, mapN8nExecutionStatus } from "./status-view.js";
import {
  loadWorkflowExecutionStore,
  loadWorkflowSpec,
  mutateWorkflowExecutionStore,
  type WorkflowStoreContext,
} from "./store.js";
import type {
  WorkflowBranchResolutionMode,
  WorkflowExecutionEventLevel,
  WorkflowExecutionRecord,
  WorkflowExecutionStepRecord,
  WorkflowExecutionStepStatus,
  WorkflowExecutionStatus,
  WorkflowSpec,
  WorkflowTopology,
} from "./types.js";

function findExecutionRecord(store: { executions: WorkflowExecutionRecord[] }, ref: string) {
  const normalized = ref.trim().toLowerCase();
  return store.executions.find(
    (entry) =>
      entry.executionId.toLowerCase() === normalized ||
      entry.n8nExecutionId?.toLowerCase() === normalized,
  );
}

function pushExecutionEvent(
  entry: WorkflowExecutionRecord,
  event: {
    level?: WorkflowExecutionEventLevel;
    type: string;
    message: string;
    details?: Record<string, unknown>;
  },
) {
  const events = entry.events ?? [];
  events.unshift({
    at: Date.now(),
    level: event.level ?? "info",
    type: event.type,
    message: event.message,
    ...(event.details ? { details: event.details } : {}),
  });
  entry.events = events.slice(0, 50);
}

function summarizeStep(spec: WorkflowSpec | null | undefined, stepId: string): string | undefined {
  const step = spec?.steps?.find((candidate) => candidate.id === stepId);
  return step?.prompt?.trim() || step?.goal?.trim() || step?.title?.trim() || undefined;
}

function resolveStepPath(step: WorkflowSpec["steps"][number]): string {
  return step.path?.trim() || "main";
}

function resolveBranchResolutionMode(
  spec: WorkflowSpec,
  step: WorkflowSpec["steps"][number],
): WorkflowBranchResolutionMode {
  const branchGroup = step.branchGroup?.trim();
  if (!branchGroup) {
    return "exclusive";
  }
  const path = resolveStepPath(step);
  const stepsInGroup = spec.steps.filter(
    (candidate) => candidate.branchGroup?.trim() === branchGroup,
  );
  const hasParallelSibling = stepsInGroup.some(
    (candidate) =>
      candidate.id !== step.id &&
      resolveStepPath(candidate) !== path &&
      (candidate.activation?.mode ?? "sequential") === "fan_out",
  );
  return (step.activation?.mode ?? "sequential") === "fan_out" || hasParallelSibling
    ? "parallel"
    : "exclusive";
}

function resolveParallelFailurePolicy(
  step: WorkflowSpec["steps"][number],
): "fail_fast" | "continue" | undefined {
  return step.activation?.parallel?.failurePolicy;
}

function resolveParallelJoinPolicy(
  step: WorkflowSpec["steps"][number],
): "all" | "best_effort" | undefined {
  return step.activation?.parallel?.joinPolicy;
}

function resolveCompensationMode(
  step: WorkflowSpec["steps"][number],
): "none" | "crawclaw_agent" | undefined {
  return step.compensation?.mode;
}

function resolveStepActivationMode(
  step: WorkflowSpec["steps"][number],
): NonNullable<WorkflowExecutionStepRecord["activationMode"]> {
  return step.activation?.mode ?? "sequential";
}

function isLinearSequentialStep(step: WorkflowExecutionStepRecord): boolean {
  return (
    (step.path ?? "main") === "main" &&
    !step.branchGroup &&
    (step.activationMode ?? "sequential") === "sequential" &&
    !step.activationWhen &&
    !step.activationFromStepIds?.length
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveStepSourceIds(spec: WorkflowSpec, index: number): string[] {
  const step = spec.steps[index];
  if (!step) {
    return [];
  }
  const explicitSources =
    step.activation?.fromStepIds?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (explicitSources.length > 0) {
    return [...new Set(explicitSources)];
  }
  if (index === 0) {
    return [];
  }
  const path = resolveStepPath(step);
  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = spec.steps[candidateIndex];
    if (candidate && resolveStepPath(candidate) === path) {
      return [candidate.id];
    }
  }
  if (path === "main") {
    return [spec.steps[index - 1].id];
  }
  return [];
}

function extractN8nRunData(
  remote: N8nExecutionRecord | null | undefined,
): Record<string, unknown[]> | null {
  const data = remote?.data;
  if (!isRecord(data)) {
    return null;
  }
  const nestedResultData = isRecord(data.resultData) ? data.resultData : null;
  const candidate =
    (nestedResultData && isRecord(nestedResultData.runData) ? nestedResultData.runData : null) ??
    (isRecord(data.runData) ? data.runData : null);
  if (!candidate) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(candidate)
      .filter(([key, value]) => key.trim() && Array.isArray(value))
      .map(([key, value]) => [key, value as unknown[]]),
  );
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
  if (typeof value === "string" || typeof value !== "object") {
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

function isTerminalStepStatus(status: WorkflowExecutionStepStatus): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled" || status === "skipped"
  );
}

function setStepStatus(
  step: WorkflowExecutionStepRecord,
  status: WorkflowExecutionStepStatus,
  timestamp: number,
  options?: {
    executor?: WorkflowExecutionStepRecord["executor"];
    summary?: string;
    skippedReason?: string;
  },
): void {
  step.status = status;
  step.updatedAt = timestamp;
  if (!step.startedAt && (status === "running" || status === "waiting" || status === "succeeded")) {
    step.startedAt = timestamp;
  }
  if (isTerminalStepStatus(status)) {
    step.endedAt = step.endedAt ?? timestamp;
  } else {
    delete step.endedAt;
  }
  if (options?.executor) {
    step.executor = options.executor;
  }
  if (options?.summary) {
    step.summary = options.summary;
  }
  if (status === "skipped") {
    step.skippedReason =
      options?.skippedReason ?? step.skippedReason ?? "Branch path not selected.";
  } else if (options?.skippedReason) {
    step.skippedReason = options.skippedReason;
  } else {
    delete step.skippedReason;
  }
}

function deriveWorkflowSpecFromExecution(entry: WorkflowExecutionRecord): WorkflowSpec | null {
  if (!entry.steps?.length) {
    return null;
  }
  return {
    workflowId: entry.workflowId,
    name: entry.workflowName ?? entry.workflowId,
    goal: entry.workflowName ?? entry.workflowId,
    topology: entry.topology ?? "linear_v1",
    tags: [],
    inputs: [],
    outputs: [],
    steps: entry.steps.map((step) => ({
      id: step.stepId,
      kind: step.kind ?? "native",
      ...(step.title ? { title: step.title } : {}),
      ...(step.summary ? { goal: step.summary } : {}),
      ...(step.path ? { path: step.path } : {}),
      ...(step.branchGroup ? { branchGroup: step.branchGroup } : {}),
      ...(step.activationMode || step.activationWhen || step.activationFromStepIds?.length
        ? {
            activation: {
              ...(step.activationMode ? { mode: step.activationMode } : {}),
              ...(step.activationWhen ? { when: step.activationWhen } : {}),
              ...(step.activationFromStepIds?.length
                ? { fromStepIds: [...step.activationFromStepIds] }
                : {}),
              ...(step.parallelFailurePolicy ||
              step.parallelJoinPolicy ||
              typeof step.retryOnFail === "boolean" ||
              typeof step.maxTries === "number" ||
              typeof step.waitBetweenTriesMs === "number"
                ? {
                    parallel: {
                      ...(step.parallelFailurePolicy
                        ? { failurePolicy: step.parallelFailurePolicy }
                        : {}),
                      ...(step.parallelJoinPolicy ? { joinPolicy: step.parallelJoinPolicy } : {}),
                      ...(typeof step.maxActiveBranches === "number"
                        ? { maxActiveBranches: step.maxActiveBranches }
                        : {}),
                      ...(typeof step.retryOnFail === "boolean"
                        ? { retryOnFail: step.retryOnFail }
                        : {}),
                      ...(typeof step.maxTries === "number" ? { maxTries: step.maxTries } : {}),
                      ...(typeof step.waitBetweenTriesMs === "number"
                        ? { waitBetweenTriesMs: step.waitBetweenTriesMs }
                        : {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(step.compensationMode ? { compensation: { mode: step.compensationMode } } : {}),
      ...(step.terminalOnSuccess ? { terminalOnSuccess: true } : {}),
      ...(step.kind === "human_wait" ? { wait: { kind: "input", prompt: step.summary } } : {}),
    })),
    createdAt: entry.startedAt,
    updatedAt: entry.updatedAt,
  };
}

function applyBranchAwareRemoteProjection(
  entry: WorkflowExecutionRecord,
  spec: WorkflowSpec,
  remote: N8nExecutionRecord,
  status: WorkflowExecutionStatus,
  timestamp: number,
): boolean {
  const runData = extractN8nRunData(remote);
  if (!entry.steps?.length || !runData) {
    return false;
  }
  const executedNodeNames = new Set(
    Object.entries(runData)
      .filter(([, value]) => Array.isArray(value) && value.length > 0)
      .map(([nodeName]) => nodeName),
  );
  const lastNodeExecuted = findStringByKey(remote.data, "lastNodeExecuted");
  const stepsById = new Map(entry.steps.map((step) => [step.stepId, step] as const));

  for (let index = 0; index < spec.steps.length; index += 1) {
    const specStep = spec.steps[index];
    const entryStep = stepsById.get(specStep.id);
    if (!entryStep) {
      continue;
    }
    const nodeName = buildWorkflowStepNodeName(specStep, index);
    if (!executedNodeNames.has(nodeName)) {
      if (!isTerminalStepStatus(entryStep.status)) {
        setStepStatus(entryStep, "pending", timestamp);
      }
      continue;
    }
    if (status === "waiting_external" || status === "waiting_input") {
      const isActiveWaitingStep =
        specStep.kind === "human_wait" ||
        (lastNodeExecuted ? lastNodeExecuted === nodeName : false);
      setStepStatus(entryStep, isActiveWaitingStep ? "waiting" : "succeeded", timestamp, {
        executor: isActiveWaitingStep ? "n8n_wait" : (entryStep.executor ?? "n8n"),
        summary: summarizeStep(spec, specStep.id),
      });
      continue;
    }
    if (status === "running" && lastNodeExecuted === nodeName) {
      setStepStatus(entryStep, "running", timestamp, {
        executor: entryStep.executor ?? "n8n",
        summary: summarizeStep(spec, specStep.id),
      });
      continue;
    }
    if (status === "failed" && lastNodeExecuted === nodeName) {
      setStepStatus(entryStep, "failed", timestamp, {
        executor: entryStep.executor ?? "n8n",
        summary: summarizeStep(spec, specStep.id),
      });
      continue;
    }
    if (status === "cancelled" && lastNodeExecuted === nodeName) {
      setStepStatus(entryStep, "cancelled", timestamp, {
        executor: entryStep.executor ?? "n8n",
        summary: summarizeStep(spec, specStep.id),
      });
      continue;
    }
    if (entryStep.status === "failed" && entryStep.parallelFailurePolicy === "continue") {
      entryStep.updatedAt = timestamp;
      continue;
    }
    setStepStatus(entryStep, "succeeded", timestamp, {
      executor: entryStep.executor ?? "n8n",
      summary: summarizeStep(spec, specStep.id),
    });
  }

  const executedPathsByGroup = new Map<
    string,
    { paths: Set<string>; resolution: WorkflowBranchResolutionMode }
  >();
  for (let index = 0; index < spec.steps.length; index += 1) {
    const specStep = spec.steps[index];
    const entryStep = stepsById.get(specStep.id);
    if (!entryStep || entryStep.status === "pending" || entryStep.status === "skipped") {
      continue;
    }
    const group = specStep.branchGroup?.trim();
    if (!group) {
      continue;
    }
    const path = resolveStepPath(specStep);
    const existing = executedPathsByGroup.get(group);
    const activePaths = existing?.paths ?? new Set<string>();
    activePaths.add(path);
    executedPathsByGroup.set(group, {
      paths: activePaths,
      resolution: resolveBranchResolutionMode(spec, specStep),
    });
  }

  for (let index = 0; index < spec.steps.length; index += 1) {
    const specStep = spec.steps[index];
    const entryStep = stepsById.get(specStep.id);
    if (!entryStep || entryStep.status !== "pending") {
      continue;
    }
    const group = specStep.branchGroup?.trim();
    const executedPaths = group ? executedPathsByGroup.get(group) : undefined;
    if (
      executedPaths?.resolution === "exclusive" &&
      executedPaths.paths.size > 0 &&
      !executedPaths.paths.has(resolveStepPath(specStep))
    ) {
      setStepStatus(entryStep, "skipped", timestamp, {
        executor: entryStep.executor,
        skippedReason: `Branch group "${group}" selected a different path.`,
      });
    }
  }

  let mutated = true;
  while (mutated) {
    mutated = false;
    for (let index = 0; index < spec.steps.length; index += 1) {
      const specStep = spec.steps[index];
      const entryStep = stepsById.get(specStep.id);
      if (!entryStep || entryStep.status !== "pending") {
        continue;
      }
      const sourceStepIds = resolveStepSourceIds(spec, index);
      if (sourceStepIds.length === 0) {
        continue;
      }
      const upstreamSteps = sourceStepIds
        .map((sourceStepId) => stepsById.get(sourceStepId))
        .filter((step): step is WorkflowExecutionStepRecord => Boolean(step));
      if (upstreamSteps.length === 0) {
        continue;
      }
      if (upstreamSteps.every((step) => step.status === "skipped")) {
        setStepStatus(entryStep, "skipped", timestamp, {
          executor: entryStep.executor,
          skippedReason: "Upstream branch path was skipped.",
        });
        mutated = true;
      }
    }
  }

  const explicitlyActiveStep = lastNodeExecuted
    ? spec.steps.find(
        (specStep, index) =>
          buildWorkflowStepNodeName(specStep, index) === lastNodeExecuted &&
          stepsById.get(specStep.id)?.status !== "pending",
      )
    : undefined;
  const activeStep =
    (explicitlyActiveStep ? stepsById.get(explicitlyActiveStep.id) : undefined) ??
    entry.steps.find((step) => step.status === "waiting") ??
    entry.steps.find((step) => step.status === "running") ??
    undefined;
  if (activeStep) {
    entry.currentStepId = activeStep.stepId;
    entry.currentExecutor = activeStep.executor ?? entry.currentExecutor;
  }
  return true;
}

function autoFinalizeSucceededSteps(
  steps: WorkflowExecutionStepRecord[],
  topology: WorkflowTopology | undefined,
  timestamp: number,
): void {
  if (topology !== undefined && topology !== "linear_v1") {
    for (const step of steps) {
      if (step.status === "running" || step.status === "waiting") {
        step.status = "succeeded";
        step.updatedAt = timestamp;
        step.endedAt = step.endedAt ?? timestamp;
      }
    }
    return;
  }

  for (const step of steps) {
    if (!isLinearSequentialStep(step)) {
      break;
    }
    if (step.status !== "succeeded") {
      step.status = "succeeded";
      step.updatedAt = timestamp;
      step.endedAt = step.endedAt ?? timestamp;
    }
    if (step.terminalOnSuccess) {
      break;
    }
  }
}

export async function createWorkflowExecutionRecord(
  context: WorkflowStoreContext,
  params: {
    workflowId: string;
    workflowName?: string;
    n8nWorkflowId?: string;
    remote?: N8nExecutionRecord | null;
    spec?: WorkflowSpec | null;
    initialStatus?: WorkflowExecutionStatus;
  },
): Promise<WorkflowExecutionRecord> {
  return await mutateWorkflowExecutionStore(context, async (store) => {
    const now = Date.now();
    const remoteExecutionId = getN8nExecutionId(params.remote);
    const status = params.remote
      ? mapN8nExecutionStatus(params.remote)
      : (params.initialStatus ?? "queued");
    const executionSpec = params.spec;
    const steps = executionSpec?.steps?.length
      ? executionSpec.steps.map<WorkflowExecutionStepRecord>((step, index) => ({
          stepId: step.id,
          ...(step.title ? { title: step.title } : {}),
          kind: step.kind,
          path: resolveStepPath(step),
          ...(step.branchGroup?.trim() ? { branchGroup: step.branchGroup.trim() } : {}),
          branchResolution: resolveBranchResolutionMode(executionSpec, step),
          ...(resolveParallelFailurePolicy(step)
            ? { parallelFailurePolicy: resolveParallelFailurePolicy(step) }
            : {}),
          ...(resolveParallelJoinPolicy(step)
            ? { parallelJoinPolicy: resolveParallelJoinPolicy(step) }
            : {}),
          ...(typeof step.activation?.parallel?.maxActiveBranches === "number"
            ? { maxActiveBranches: step.activation.parallel.maxActiveBranches }
            : {}),
          ...(typeof step.activation?.parallel?.retryOnFail === "boolean"
            ? { retryOnFail: step.activation.parallel.retryOnFail }
            : {}),
          ...(typeof step.activation?.parallel?.maxTries === "number"
            ? { maxTries: step.activation.parallel.maxTries }
            : {}),
          ...(typeof step.activation?.parallel?.waitBetweenTriesMs === "number"
            ? { waitBetweenTriesMs: step.activation.parallel.waitBetweenTriesMs }
            : {}),
          ...(resolveCompensationMode(step)
            ? { compensationMode: resolveCompensationMode(step) }
            : {}),
          activationMode: resolveStepActivationMode(step),
          ...(step.activation?.when?.trim() ? { activationWhen: step.activation.when.trim() } : {}),
          ...(step.activation?.fromStepIds?.length
            ? { activationFromStepIds: [...step.activation.fromStepIds] }
            : {}),
          ...(step.terminalOnSuccess ? { terminalOnSuccess: true } : {}),
          ...(summarizeStep(executionSpec, step.id)
            ? { summary: summarizeStep(executionSpec, step.id) }
            : {}),
          status: status === "queued" ? "pending" : index === 0 ? "running" : "pending",
          executor:
            step.kind === "crawclaw_agent"
              ? "crawclaw_agent"
              : step.kind === "human_wait"
                ? "n8n_wait"
                : "n8n",
          ...(status === "queued" ? {} : index === 0 ? { startedAt: now } : {}),
          updatedAt: now,
        }))
      : undefined;
    const record: WorkflowExecutionRecord = {
      executionId: `exec_${randomUUID().slice(0, 8)}`,
      workflowId: params.workflowId,
      ...(params.workflowName ? { workflowName: params.workflowName } : {}),
      ...(params.spec?.topology ? { topology: params.spec.topology } : {}),
      ...(params.n8nWorkflowId ? { n8nWorkflowId: params.n8nWorkflowId } : {}),
      ...(remoteExecutionId ? { n8nExecutionId: remoteExecutionId } : {}),
      status,
      ...(steps?.[0]?.stepId ? { currentStepId: steps[0].stepId } : {}),
      currentExecutor:
        status === "waiting_external" || status === "waiting_input"
          ? "n8n_wait"
          : (steps?.[0]?.executor ?? "n8n"),
      ...(getN8nExecutionStatus(params.remote)
        ? { remoteStatus: getN8nExecutionStatus(params.remote) }
        : {}),
      ...(typeof params.remote?.finished === "boolean"
        ? { remoteFinished: params.remote.finished }
        : {}),
      startedAt: now,
      updatedAt: now,
      ...(status === "succeeded" || status === "failed" || status === "cancelled"
        ? { endedAt: now }
        : {}),
      ...(steps ? { steps } : {}),
    };
    pushExecutionEvent(record, {
      type: "execution.created",
      message: `Execution created with status ${status}.`,
      details: {
        workflowId: record.workflowId,
        ...(record.n8nExecutionId ? { n8nExecutionId: record.n8nExecutionId } : {}),
      },
    });
    store.executions.push(record);
    return record;
  });
}

export async function listWorkflowExecutions(
  context: WorkflowStoreContext,
  options: { workflowId?: string; limit?: number } = {},
): Promise<WorkflowExecutionRecord[]> {
  const store = await loadWorkflowExecutionStore(context);
  const filtered = options.workflowId
    ? store.executions.filter((entry) => entry.workflowId === options.workflowId)
    : store.executions;
  const sorted = [...filtered].toSorted((a, b) => b.updatedAt - a.updatedAt);
  if (typeof options.limit === "number") {
    return sorted.slice(0, Math.max(1, options.limit));
  }
  return sorted;
}

export async function getWorkflowExecution(
  context: WorkflowStoreContext,
  ref: string,
): Promise<WorkflowExecutionRecord | null> {
  const store = await loadWorkflowExecutionStore(context);
  return findExecutionRecord(store, ref) ?? null;
}

export async function attachWorkflowExecutionRemoteRef(
  context: WorkflowStoreContext,
  ref: string,
  params: {
    n8nExecutionId: string;
    n8nWorkflowId?: string;
    remote?: N8nExecutionRecord | null;
  },
): Promise<WorkflowExecutionRecord | null> {
  return await mutateWorkflowExecutionStore(context, async (store) => {
    const entry = findExecutionRecord(store, ref);
    if (!entry) {
      return null;
    }
    entry.n8nExecutionId = params.n8nExecutionId.trim();
    if (params.n8nWorkflowId?.trim()) {
      entry.n8nWorkflowId = params.n8nWorkflowId.trim();
    }
    if (params.remote) {
      const mappedStatus = mapN8nExecutionStatus(params.remote);
      entry.remoteStatus = getN8nExecutionStatus(params.remote) ?? entry.remoteStatus;
      entry.remoteFinished =
        typeof params.remote.finished === "boolean" ? params.remote.finished : entry.remoteFinished;
      if (entry.status === "queued" || entry.status === "running") {
        entry.status = mappedStatus;
      }
      if (mappedStatus === "waiting_external" || mappedStatus === "waiting_input") {
        delete entry.endedAt;
      }
    }
    entry.updatedAt = Date.now();
    return entry;
  });
}

export async function syncWorkflowExecutionFromN8n(
  context: WorkflowStoreContext,
  ref: string,
  remote: N8nExecutionRecord,
): Promise<WorkflowExecutionRecord | null> {
  const hintedExecution = await getWorkflowExecution(context, ref);
  const specFromStore = hintedExecution?.workflowId
    ? await loadWorkflowSpec(context, hintedExecution.workflowId)
    : null;
  const spec =
    specFromStore ?? (hintedExecution ? deriveWorkflowSpecFromExecution(hintedExecution) : null);
  return await mutateWorkflowExecutionStore(context, async (store) => {
    const entry = findExecutionRecord(store, ref);
    if (!entry) {
      return null;
    }
    const remoteExecutionId = getN8nExecutionId(remote);
    const previousStatus = entry.status;
    const previousRemoteStatus = entry.remoteStatus;
    const status = mapN8nExecutionStatus(remote);
    entry.status = status;
    entry.updatedAt = Date.now();
    entry.currentExecutor =
      status === "waiting_external" || status === "waiting_input" ? "n8n_wait" : "n8n";
    if (remoteExecutionId) {
      entry.n8nExecutionId = remoteExecutionId;
    }
    const remoteStatus = getN8nExecutionStatus(remote);
    if (remoteStatus) {
      entry.remoteStatus = remoteStatus;
    }
    if (typeof remote.finished === "boolean") {
      entry.remoteFinished = remote.finished;
    }
    if (entry.steps?.length) {
      const appliedBranchProjection =
        (entry.topology ?? spec?.topology) === "branch_v2" && spec
          ? applyBranchAwareRemoteProjection(entry, spec, remote, status, entry.updatedAt)
          : false;
      if (!appliedBranchProjection && status === "cancelled") {
        for (const step of entry.steps) {
          if (step.status === "pending" || step.status === "running" || step.status === "waiting") {
            step.status = "cancelled";
            step.updatedAt = entry.updatedAt;
            step.endedAt = step.endedAt ?? entry.updatedAt;
          }
        }
      } else if (!appliedBranchProjection && status === "failed") {
        const active =
          entry.steps.find((step) => step.status === "running" || step.status === "waiting") ??
          entry.steps.find((step) => step.status === "pending");
        if (active) {
          active.status = "failed";
          active.updatedAt = entry.updatedAt;
          active.endedAt = entry.updatedAt;
        }
      } else if (!appliedBranchProjection && status === "succeeded") {
        autoFinalizeSucceededSteps(entry.steps, entry.topology, entry.updatedAt);
      } else if (
        !appliedBranchProjection &&
        (status === "waiting_external" || status === "waiting_input")
      ) {
        const active =
          entry.steps.find((step) => step.status === "running") ??
          entry.steps.find((step) => step.status === "pending");
        if (active) {
          active.status = "waiting";
          active.updatedAt = entry.updatedAt;
          active.executor = "n8n_wait";
          delete active.endedAt;
        }
      }
    }
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      entry.endedAt = entry.endedAt ?? Date.now();
    } else {
      delete entry.endedAt;
    }
    if (previousStatus !== entry.status || previousRemoteStatus !== entry.remoteStatus) {
      pushExecutionEvent(entry, {
        type: "execution.status",
        level: status === "failed" ? "error" : status === "cancelled" ? "warn" : "info",
        message: `Execution status updated to ${entry.status}.`,
        details: entry.remoteStatus ? { remoteStatus: entry.remoteStatus } : {},
      });
    }
    return entry;
  });
}

export async function updateWorkflowExecutionStep(
  context: WorkflowStoreContext,
  ref: string,
  params: {
    stepId: string;
    status: WorkflowExecutionStepStatus;
    executor?: WorkflowExecutionStepRecord["executor"];
    summary?: string;
    error?: string;
  },
): Promise<WorkflowExecutionRecord | null> {
  return await mutateWorkflowExecutionStore(context, async (store) => {
    const entry = findExecutionRecord(store, ref);
    if (!entry?.steps?.length) {
      return null;
    }
    const target = entry.steps.find((step) => step.stepId === params.stepId);
    if (!target) {
      return null;
    }
    const now = Date.now();
    target.status = params.status;
    target.updatedAt = now;
    if (!target.startedAt && params.status === "running") {
      target.startedAt = now;
    }
    if (
      params.status === "succeeded" ||
      params.status === "skipped" ||
      params.status === "failed" ||
      params.status === "cancelled"
    ) {
      target.endedAt = now;
    } else {
      delete target.endedAt;
    }
    if (params.executor) {
      target.executor = params.executor;
    }
    if (params.summary) {
      target.summary = params.summary;
    }
    if (params.error) {
      target.error = params.error;
    }
    if (params.status === "skipped") {
      target.skippedReason = params.summary ?? target.skippedReason ?? "Branch path not selected.";
    } else if (!params.summary) {
      delete target.skippedReason;
    }

    const targetIndex = entry.steps.findIndex((step) => step.stepId === params.stepId);
    if (
      params.status === "succeeded" &&
      !target.terminalOnSuccess &&
      (entry.topology ?? "linear_v1") === "linear_v1" &&
      targetIndex >= 0 &&
      targetIndex + 1 < entry.steps.length
    ) {
      const next = entry.steps[targetIndex + 1];
      if (next.status === "pending" && isLinearSequentialStep(next)) {
        next.status = "running";
        next.startedAt = now;
        next.updatedAt = now;
      }
    }

    entry.currentStepId = params.stepId;
    entry.currentExecutor = params.executor ?? target.executor ?? entry.currentExecutor;
    entry.updatedAt = now;
    if (params.status === "running") {
      entry.status = "running";
      delete entry.endedAt;
    } else if (params.status === "waiting") {
      entry.status = params.executor === "n8n_wait" ? "waiting_external" : "waiting_input";
      delete entry.endedAt;
    } else if (params.status === "failed") {
      if (target.parallelFailurePolicy === "continue") {
        entry.status = "running";
        delete entry.endedAt;
      } else {
        entry.status = "failed";
        entry.errorMessage = params.error ?? entry.errorMessage;
        entry.endedAt = now;
      }
    } else if (params.status === "cancelled") {
      entry.status = "cancelled";
      entry.endedAt = now;
    } else if (params.status === "skipped") {
      const allCompleted = entry.steps.every(
        (step) => step.status === "succeeded" || step.status === "skipped",
      );
      if (allCompleted) {
        entry.status = "succeeded";
        entry.endedAt = now;
      } else {
        entry.status = "running";
        delete entry.endedAt;
      }
    } else if (params.status === "succeeded") {
      const allSucceeded = entry.steps.every(
        (step) => step.status === "succeeded" || step.status === "skipped",
      );
      if (allSucceeded) {
        entry.status = "succeeded";
        entry.endedAt = now;
      } else if (target.terminalOnSuccess) {
        entry.status = "succeeded";
        entry.endedAt = now;
      } else {
        entry.status = "running";
        delete entry.endedAt;
        const next =
          targetIndex >= 0 && targetIndex + 1 < entry.steps.length
            ? entry.steps[targetIndex + 1]
            : undefined;
        if (next?.status === "running") {
          entry.currentStepId = next.stepId;
          entry.currentExecutor = next.executor ?? entry.currentExecutor;
        }
      }
    }
    pushExecutionEvent(entry, {
      type: "execution.step",
      level: params.status === "failed" ? "error" : params.status === "cancelled" ? "warn" : "info",
      message: `Step ${params.stepId} marked ${params.status}.`,
      details: {
        stepId: params.stepId,
        status: params.status,
        ...(params.executor ? { executor: params.executor } : {}),
        ...(params.summary ? { summary: params.summary } : {}),
        ...(params.error ? { error: params.error } : {}),
      },
    });
    return entry;
  });
}

export async function updateWorkflowExecutionStepCompensation(
  context: WorkflowStoreContext,
  ref: string,
  params: {
    stepId: string;
    status: "running" | "succeeded" | "failed" | "cancelled";
    summary?: string;
    error?: string;
  },
): Promise<WorkflowExecutionRecord | null> {
  return await mutateWorkflowExecutionStore(context, async (store) => {
    const entry = findExecutionRecord(store, ref);
    if (!entry?.steps?.length) {
      return null;
    }
    const target = entry.steps.find((step) => step.stepId === params.stepId);
    if (!target) {
      return null;
    }
    const now = Date.now();
    target.compensationStatus = params.status;
    if (params.summary) {
      target.compensationSummary = params.summary;
    }
    if (params.error) {
      target.compensationError = params.error;
    } else if (params.status === "running") {
      delete target.compensationError;
    }
    target.updatedAt = now;
    entry.updatedAt = now;
    pushExecutionEvent(entry, {
      type: "execution.compensation",
      level: params.status === "failed" ? "error" : params.status === "cancelled" ? "warn" : "info",
      message: `Compensation for step ${params.stepId} marked ${params.status}.`,
      details: {
        stepId: params.stepId,
        status: params.status,
        ...(params.summary ? { summary: params.summary } : {}),
        ...(params.error ? { error: params.error } : {}),
      },
    });
    return entry;
  });
}

export async function appendWorkflowExecutionEvent(
  context: WorkflowStoreContext,
  ref: string,
  event: {
    level?: WorkflowExecutionEventLevel;
    type: string;
    message: string;
    details?: Record<string, unknown>;
  },
): Promise<WorkflowExecutionRecord | null> {
  return await mutateWorkflowExecutionStore(context, async (store) => {
    const entry = findExecutionRecord(store, ref);
    if (!entry) {
      return null;
    }
    entry.updatedAt = Date.now();
    pushExecutionEvent(entry, event);
    return entry;
  });
}

export async function deleteWorkflowExecutions(
  context: WorkflowStoreContext,
  workflowId: string,
): Promise<number> {
  return await mutateWorkflowExecutionStore(context, async (store) => {
    const before = store.executions.length;
    store.executions = store.executions.filter((entry) => entry.workflowId !== workflowId);
    return before - store.executions.length;
  });
}
