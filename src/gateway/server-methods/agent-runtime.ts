import { resolveSpecialAgentDefinitionBySpawnSource } from "../../agents/special/runtime/registry.js";
import { loadConfig } from "../../config/config.js";
import { cancelTaskById, getTaskById, listTaskRecords } from "../../tasks/runtime-internal.js";
import type { TaskRecord } from "../../tasks/task-registry.types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

type AgentRuntimeCategory = "memory" | "verification" | "subagents" | "acp" | "cron" | "cli";
type AgentRuntimeStatusFilter =
  | "all"
  | "running"
  | "failed"
  | "waiting"
  | "completed"
  | "attention";

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function readOptionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

function resolveCategory(task: TaskRecord): AgentRuntimeCategory {
  const spawnSource = task.agentMetadata?.spawnSource?.trim();
  if (
    spawnSource === "memory-extraction" ||
    spawnSource === "session-summary" ||
    spawnSource === "dream"
  ) {
    return "memory";
  }
  if (spawnSource === "verification") {
    return "verification";
  }
  if (task.runtime === "acp") {
    return "acp";
  }
  if (task.runtime === "cron") {
    return "cron";
  }
  if (task.runtime === "cli") {
    return "cli";
  }
  return "subagents";
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveTaskTitle(task: TaskRecord): string {
  const spawnSource = task.agentMetadata?.spawnSource?.trim();
  switch (spawnSource) {
    case "memory-extraction":
      return "Durable memory update";
    case "session-summary":
      return "Session summary refresh";
    case "dream":
      return "Memory dream run";
    case "verification":
      return "Verification run";
    default:
      break;
  }
  const definitionLabel = resolveSpecialAgentDefinitionBySpawnSource(spawnSource)?.label;
  if (definitionLabel) {
    return humanizeIdentifier(definitionLabel);
  }
  if (task.label?.trim()) {
    return humanizeIdentifier(task.label.trim());
  }
  switch (task.runtime) {
    case "subagent":
      return "Background subagent";
    case "acp":
      return "ACP background task";
    case "cron":
      return "Scheduled task";
    case "cli":
      return "CLI task";
    default:
      return task.task;
  }
}

function resolveTaskSummary(task: TaskRecord): string | null {
  return (
    task.progressSummary?.trim() ||
    task.terminalSummary?.trim() ||
    task.error?.trim() ||
    task.task.trim() ||
    null
  );
}

function mapTaskRecord(task: TaskRecord) {
  return {
    taskId: task.taskId,
    category: resolveCategory(task),
    runtime: task.runtime,
    status: task.status,
    title: resolveTaskTitle(task),
    summary: resolveTaskSummary(task),
    sessionKey: task.requesterSessionKey,
    ownerKey: task.ownerKey,
    scopeKind: task.scopeKind,
    childSessionKey: task.childSessionKey ?? null,
    agentId: task.agentId ?? null,
    runId: task.runId ?? null,
    parentTaskId: task.parentTaskId ?? null,
    sourceId: task.sourceId ?? null,
    spawnSource: task.agentMetadata?.spawnSource ?? null,
    progressSummary: task.progressSummary ?? null,
    terminalSummary: task.terminalSummary ?? null,
    error: task.error ?? null,
    createdAt: task.createdAt,
    updatedAt: task.lastEventAt ?? task.startedAt ?? task.createdAt,
    startedAt: task.startedAt ?? null,
    endedAt: task.endedAt ?? null,
  };
}

function matchesStatusFilter(task: TaskRecord, status: AgentRuntimeStatusFilter): boolean {
  switch (status) {
    case "all":
      return true;
    case "running":
      return task.status === "running";
    case "waiting":
      return task.status === "queued";
    case "failed":
      return task.status === "failed" || task.status === "timed_out" || task.status === "lost";
    case "completed":
      return task.status === "succeeded" || task.status === "cancelled";
    case "attention":
      return task.status === "failed" || task.status === "timed_out" || task.status === "lost";
    default:
      return true;
  }
}

function matchesQueryFilter(
  task: TaskRecord,
  params: {
    agent?: string;
    sessionKey?: string;
    taskId?: string;
    runId?: string;
  },
): boolean {
  const agent = params.agent?.trim().toLowerCase();
  if (agent && task.agentId?.trim().toLowerCase() !== agent) {
    return false;
  }
  const sessionKey = params.sessionKey?.trim().toLowerCase();
  if (
    sessionKey &&
    task.requesterSessionKey.trim().toLowerCase() !== sessionKey &&
    task.childSessionKey?.trim().toLowerCase() !== sessionKey
  ) {
    return false;
  }
  const taskId = params.taskId?.trim().toLowerCase();
  if (taskId && !task.taskId.trim().toLowerCase().includes(taskId)) {
    return false;
  }
  const runId = params.runId?.trim().toLowerCase();
  if (runId && !task.runId?.trim().toLowerCase().includes(runId)) {
    return false;
  }
  return true;
}

function filterTasks(params: {
  category?: string;
  status?: string;
  agent?: string;
  sessionKey?: string;
  taskId?: string;
  runId?: string;
}): TaskRecord[] {
  const category = params.category?.trim() || "all";
  const status = (params.status?.trim() as AgentRuntimeStatusFilter | undefined) ?? "all";
  return listTaskRecords()
    .filter((task) => category === "all" || resolveCategory(task) === category)
    .filter((task) => matchesStatusFilter(task, status))
    .filter((task) => matchesQueryFilter(task, params))
    .toSorted((left, right) => {
      const leftUpdated = left.lastEventAt ?? left.startedAt ?? left.createdAt;
      const rightUpdated = right.lastEventAt ?? right.startedAt ?? right.createdAt;
      return rightUpdated - leftUpdated;
    });
}

function buildSummary(tasks: TaskRecord[]) {
  const byCategory: Record<AgentRuntimeCategory, number> = {
    memory: 0,
    verification: 0,
    subagents: 0,
    acp: 0,
    cron: 0,
    cli: 0,
  };
  let running = 0;
  let failed = 0;
  let waiting = 0;
  let completed = 0;
  let lastCompletedAt: number | null = null;
  for (const task of tasks) {
    byCategory[resolveCategory(task)] += 1;
    if (task.status === "queued") {
      waiting += 1;
    } else if (task.status === "running") {
      running += 1;
    } else if (task.status === "failed" || task.status === "timed_out" || task.status === "lost") {
      failed += 1;
    } else {
      completed += 1;
    }
    if (typeof task.endedAt === "number" && Number.isFinite(task.endedAt)) {
      lastCompletedAt = Math.max(lastCompletedAt ?? 0, task.endedAt);
    }
  }
  return {
    running,
    failed,
    waiting,
    completed,
    lastCompletedAt: lastCompletedAt ? new Date(lastCompletedAt).toISOString() : null,
    byCategory,
  };
}

function mapTaskDetail(task: TaskRecord) {
  const spawnSource = task.agentMetadata?.spawnSource?.trim();
  const definition = resolveSpecialAgentDefinitionBySpawnSource(spawnSource);
  const cancelable =
    (task.runtime === "subagent" || task.runtime === "acp") &&
    (task.status === "queued" || task.status === "running");
  return {
    run: mapTaskRecord(task),
    contract: {
      definitionId: definition?.id ?? null,
      definitionLabel: definition?.label ?? null,
      spawnSource: spawnSource ?? null,
      executionMode: definition?.executionMode ?? null,
      transcriptPolicy: definition?.transcriptPolicy ?? null,
      cleanup: definition?.cleanup ?? null,
      sandbox: definition?.sandbox ?? null,
      defaultRunTimeoutSeconds:
        typeof definition?.defaultRunTimeoutSeconds === "number"
          ? definition.defaultRunTimeoutSeconds
          : null,
      toolAllowlistCount: definition?.toolPolicy?.allowlist?.length ?? null,
    },
    metadata: {
      mode: task.agentMetadata?.mode ?? null,
      runtimeStateRef: task.agentMetadata?.runtimeStateRef ?? null,
      transcriptRef: task.agentMetadata?.transcriptRef ?? null,
      trajectoryRef: task.agentMetadata?.trajectoryRef ?? null,
      capabilitySnapshotRef: task.agentMetadata?.capabilitySnapshotRef ?? null,
    },
    availableActions: {
      openSession: Boolean(task.childSessionKey || task.requesterSessionKey),
      cancel: cancelable,
    },
  };
}

export const agentRuntimeHandlers: GatewayRequestHandlers = {
  "agentRuntime.summary": async ({ params, respond }) => {
    try {
      const runtimeTasks = filterTasks(asRecord(params));
      respond(true, buildSummary(runtimeTasks), undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `agentRuntime.summary failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "agentRuntime.list": async ({ params, respond }) => {
    try {
      const requestParams = asRecord(params);
      const runtimeTasks = filterTasks(requestParams);
      const limit = readOptionalPositiveInt(requestParams.limit) ?? 40;
      const visibleTasks = runtimeTasks.slice(0, limit);
      respond(
        true,
        {
          summary: buildSummary(runtimeTasks),
          count: visibleTasks.length,
          runs: visibleTasks.map((task) => mapTaskRecord(task)),
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `agentRuntime.list failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "agentRuntime.get": async ({ params, respond }) => {
    try {
      const taskId = readOptionalString(asRecord(params).taskId);
      if (!taskId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "agentRuntime.get requires taskId"),
        );
        return;
      }
      const task = getTaskById(taskId);
      if (!task) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Task not found: ${taskId}`),
        );
        return;
      }
      respond(true, mapTaskDetail(task), undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `agentRuntime.get failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },

  "agentRuntime.cancel": async ({ params, respond }) => {
    try {
      const taskId = readOptionalString(asRecord(params).taskId);
      if (!taskId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "agentRuntime.cancel requires taskId"),
        );
        return;
      }
      const result = await cancelTaskById({
        cfg: loadConfig(),
        taskId,
      });
      respond(
        true,
        {
          found: result.found,
          cancelled: result.cancelled,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.task ? { task: mapTaskRecord(result.task) } : {}),
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `agentRuntime.cancel failed: ${describeUnknownError(error)}`,
        ),
      );
    }
  },
};
