import type { AgentRunContext } from "../../infra/agent-events.js";
import { getAgentRunContext } from "../../infra/agent-events.js";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import type { AgentTaskMode, TaskRuntime } from "../../tasks/task-registry.types.js";

export type AgentRuntimeStatus =
  | "created"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentRuntimeState = {
  runId: string;
  taskId?: string;
  runtime?: TaskRuntime;
  mode?: AgentTaskMode;
  agentId?: string;
  parentAgentId?: string;
  sessionId?: string;
  sessionKey?: string;
  label?: string;
  task?: string;
  status: AgentRuntimeStatus;
  toolCallCount: number;
  currentStep?: string;
  lastToolName?: string;
  lastError?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  lastHeartbeat?: number;
  updatedAt: number;
};

export type AgentRuntimeStatePatch = {
  taskId?: string;
  runtime?: TaskRuntime;
  mode?: AgentTaskMode;
  agentId?: string;
  parentAgentId?: string;
  sessionId?: string;
  sessionKey?: string;
  label?: string;
  task?: string;
  status?: AgentRuntimeStatus;
  toolCallCount?: number;
  currentStep?: string | null;
  lastToolName?: string | null;
  lastError?: string | null;
  createdAt?: number;
  startedAt?: number;
  endedAt?: number;
  lastHeartbeat?: number;
  updatedAt?: number;
};

type AgentRuntimeStateStore = {
  byRunId: Map<string, AgentRuntimeState>;
};

const AGENT_RUNTIME_STATE_KEY = Symbol.for("crawclaw.agentRuntime.state");
const TERMINAL_AGENT_RUNTIME_STATUSES = new Set<AgentRuntimeStatus>([
  "completed",
  "failed",
  "cancelled",
]);

function getAgentRuntimeStateStore(): AgentRuntimeStateStore {
  return resolveGlobalSingleton<AgentRuntimeStateStore>(AGENT_RUNTIME_STATE_KEY, () => ({
    byRunId: new Map<string, AgentRuntimeState>(),
  }));
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveContextPatch(context: AgentRunContext | undefined): AgentRuntimeStatePatch {
  if (!context) {
    return {};
  }
  return {
    ...(normalizeOptionalString(context.sessionId)
      ? { sessionId: normalizeOptionalString(context.sessionId) }
      : {}),
    ...(normalizeOptionalString(context.sessionKey)
      ? { sessionKey: normalizeOptionalString(context.sessionKey) }
      : {}),
    ...(normalizeOptionalString(context.agentId)
      ? { agentId: normalizeOptionalString(context.agentId) }
      : {}),
    ...(normalizeOptionalString(context.parentAgentId)
      ? { parentAgentId: normalizeOptionalString(context.parentAgentId) }
      : {}),
    ...(normalizeOptionalString(context.taskId)
      ? { taskId: normalizeOptionalString(context.taskId) }
      : {}),
    ...(context.taskRuntime ? { runtime: context.taskRuntime } : {}),
    ...(context.taskMode ? { mode: context.taskMode } : {}),
    ...(normalizeOptionalString(context.label)
      ? { label: normalizeOptionalString(context.label) }
      : {}),
    ...(normalizeOptionalString(context.task)
      ? { task: normalizeOptionalString(context.task) }
      : {}),
  };
}

function mergeAgentRuntimeState(
  existing: AgentRuntimeState | undefined,
  runId: string,
  patch: AgentRuntimeStatePatch,
): AgentRuntimeState {
  const now = patch.updatedAt ?? Date.now();
  const contextPatch = resolveContextPatch(getAgentRunContext(runId));
  const base: AgentRuntimeState = existing ?? {
    runId,
    status: "created",
    toolCallCount: 0,
    createdAt: patch.createdAt ?? now,
    updatedAt: now,
  };
  const currentStatus = existing?.status ?? base.status;
  const requestedStatus = patch.status ?? currentStatus;
  const status =
    TERMINAL_AGENT_RUNTIME_STATUSES.has(currentStatus) && requestedStatus !== currentStatus
      ? currentStatus
      : requestedStatus;
  const currentStep =
    patch.currentStep === null
      ? undefined
      : patch.currentStep === undefined
        ? base.currentStep
        : normalizeOptionalString(patch.currentStep);
  const lastToolName =
    patch.lastToolName === null
      ? undefined
      : patch.lastToolName === undefined
        ? base.lastToolName
        : normalizeOptionalString(patch.lastToolName);
  const lastError =
    patch.lastError === null
      ? undefined
      : patch.lastError === undefined
        ? base.lastError
        : normalizeOptionalString(patch.lastError);

  return {
    ...base,
    ...contextPatch,
    ...(normalizeOptionalString(patch.taskId)
      ? { taskId: normalizeOptionalString(patch.taskId) }
      : {}),
    ...(patch.runtime ? { runtime: patch.runtime } : {}),
    ...(patch.mode ? { mode: patch.mode } : {}),
    ...(normalizeOptionalString(patch.agentId)
      ? { agentId: normalizeOptionalString(patch.agentId) }
      : {}),
    ...(normalizeOptionalString(patch.parentAgentId)
      ? { parentAgentId: normalizeOptionalString(patch.parentAgentId) }
      : {}),
    ...(normalizeOptionalString(patch.sessionId)
      ? { sessionId: normalizeOptionalString(patch.sessionId) }
      : {}),
    ...(normalizeOptionalString(patch.sessionKey)
      ? { sessionKey: normalizeOptionalString(patch.sessionKey) }
      : {}),
    ...(normalizeOptionalString(patch.label)
      ? { label: normalizeOptionalString(patch.label) }
      : {}),
    ...(normalizeOptionalString(patch.task) ? { task: normalizeOptionalString(patch.task) } : {}),
    status,
    toolCallCount:
      typeof patch.toolCallCount === "number" && Number.isFinite(patch.toolCallCount)
        ? Math.max(0, Math.trunc(patch.toolCallCount))
        : base.toolCallCount,
    currentStep,
    lastToolName,
    lastError,
    ...(typeof patch.startedAt === "number" ? { startedAt: patch.startedAt } : {}),
    ...(typeof patch.endedAt === "number" ? { endedAt: patch.endedAt } : {}),
    ...(typeof patch.lastHeartbeat === "number" ? { lastHeartbeat: patch.lastHeartbeat } : {}),
    createdAt: typeof patch.createdAt === "number" ? patch.createdAt : base.createdAt,
    updatedAt: now,
  };
}

function setAgentRuntimeState(runId: string, patch: AgentRuntimeStatePatch): AgentRuntimeState {
  const store = getAgentRuntimeStateStore();
  const next = mergeAgentRuntimeState(store.byRunId.get(runId), runId, patch);
  store.byRunId.set(runId, next);
  return next;
}

export function registerAgentRuntimeState(params: { runId: string } & AgentRuntimeStatePatch) {
  const runId = normalizeOptionalString(params.runId);
  if (!runId) {
    throw new Error("runId is required");
  }
  return setAgentRuntimeState(runId, params);
}

export function updateAgentRuntimeState(runId: string, patch: AgentRuntimeStatePatch) {
  const normalizedRunId = normalizeOptionalString(runId);
  if (!normalizedRunId) {
    throw new Error("runId is required");
  }
  return setAgentRuntimeState(normalizedRunId, patch);
}

export function incrementAgentRuntimeToolCall(params: {
  runId: string;
  toolName?: string | null;
  currentStep?: string | null;
  updatedAt?: number;
}) {
  const existing = getAgentRuntimeState(params.runId);
  return updateAgentRuntimeState(params.runId, {
    toolCallCount: (existing?.toolCallCount ?? 0) + 1,
    lastToolName: params.toolName ?? undefined,
    currentStep: params.currentStep ?? params.toolName ?? undefined,
    status: existing?.status === "waiting" ? "running" : undefined,
    updatedAt: params.updatedAt,
  });
}

export function markAgentRuntimeStateTerminal(params: {
  runId: string;
  status: Extract<AgentRuntimeStatus, "completed" | "failed" | "cancelled">;
  endedAt?: number;
  error?: string | null;
  currentStep?: string | null;
}) {
  const normalizedRunId = normalizeOptionalString(params.runId);
  if (!normalizedRunId) {
    throw new Error("runId is required");
  }
  const existing = getAgentRuntimeState(normalizedRunId);
  if (existing && TERMINAL_AGENT_RUNTIME_STATUSES.has(existing.status)) {
    return {
      changed: false,
      state: existing,
    };
  }
  return {
    changed: true,
    state: updateAgentRuntimeState(normalizedRunId, {
      status: params.status,
      endedAt: params.endedAt ?? Date.now(),
      lastError: params.error ?? undefined,
      currentStep: params.currentStep ?? null,
    }),
  };
}

export function getAgentRuntimeState(runId: string): AgentRuntimeState | undefined {
  const normalizedRunId = normalizeOptionalString(runId);
  if (!normalizedRunId) {
    return undefined;
  }
  return getAgentRuntimeStateStore().byRunId.get(normalizedRunId);
}

export function listAgentRuntimeStates(): AgentRuntimeState[] {
  return [...getAgentRuntimeStateStore().byRunId.values()];
}

export function clearAgentRuntimeState(runId: string): void {
  const normalizedRunId = normalizeOptionalString(runId);
  if (!normalizedRunId) {
    return;
  }
  getAgentRuntimeStateStore().byRunId.delete(normalizedRunId);
}

export function resetAgentRuntimeStateForTest(): void {
  getAgentRuntimeStateStore().byRunId.clear();
}
