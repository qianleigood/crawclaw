import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveStorePath,
} from "../../config/sessions/paths.js";
import { loadSessionStore, resolveSessionStoreEntry } from "../../config/sessions/store.js";
import { writeJsonAtomic } from "../../infra/json-files.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import {
  getTaskById,
  listTaskRecords,
  mergeTaskAgentMetadataById,
} from "../../tasks/runtime-internal.js";
import type {
  AgentTaskMetadata,
  AgentTaskMode,
  TaskRecord,
  TaskRuntime,
} from "../../tasks/task-registry.types.js";
import type { AgentCapabilitySnapshotInput } from "./agent-capability-snapshot.js";
import {
  writeAgentTaskCapabilitySnapshot,
  readAgentTaskCapabilitySnapshotSync,
} from "./agent-capability-snapshot.js";
import { normalizeAgentTaskMetadata } from "./agent-task.js";

const AGENT_TASK_RUNTIME_METADATA_VERSION = 1;

export type AgentTaskRuntimeMetadata = {
  version: 1;
  taskId: string;
  runtime: TaskRuntime;
  updatedAt: number;
  agentId?: string;
  parentAgentId?: string;
  mode?: AgentTaskMode;
  spawnSource?: string;
  sessionKey?: string;
  sessionId?: string;
  sessionFile?: string;
  storePath?: string;
  transcriptPath?: string;
  transcriptRef?: string;
  trajectoryRef?: string;
  capabilitySnapshotRef?: string;
  requesterSessionKey?: string;
  runId?: string;
  label?: string;
  task?: string;
};

export type AgentTaskResumeTarget = {
  task: TaskRecord;
  metadata: AgentTaskRuntimeMetadata;
  sessionKey: string;
  agentId?: string;
  storePath?: string;
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalAgentId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? normalizeAgentId(trimmed) : undefined;
}

function normalizeMacPrivatePrefix(value: string): string {
  return value.startsWith("/private/") ? value.slice("/private".length) : value;
}

function resolveTaskRecency(task: TaskRecord): number {
  return task.lastEventAt ?? task.endedAt ?? task.startedAt ?? task.createdAt;
}

function resolveStateRelativeRef(filePath: string): string {
  const stateDir = normalizeMacPrivatePrefix(path.resolve(resolveStateDir()));
  const absolute = normalizeMacPrivatePrefix(path.resolve(filePath));
  const relative = path.relative(stateDir, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.resolve(filePath);
  }
  return relative.split(path.sep).join("/");
}

function resolveAbsoluteFromStateRef(ref: string): string {
  return path.isAbsolute(ref) ? path.resolve(ref) : path.resolve(resolveStateDir(), ref);
}

function resolveAgentTaskRuntimeDir(agentId?: string): string {
  const resolvedAgentId = normalizeOptionalAgentId(agentId);
  const stateDir = path.resolve(resolveStateDir());
  return path.join(stateDir, "agents", resolvedAgentId ?? "main", "tasks");
}

export function resolveAgentTaskRuntimeStatePath(params: {
  taskId: string;
  agentId?: string | null;
}): string {
  return path.join(
    resolveAgentTaskRuntimeDir(params.agentId ?? undefined),
    `${params.taskId}.json`,
  );
}

export function resolveAgentTaskRuntimeStateRef(params: {
  taskId: string;
  agentId?: string | null;
}): string {
  return resolveStateRelativeRef(resolveAgentTaskRuntimeStatePath(params));
}

export function resolveAgentTaskTrajectoryPath(params: {
  taskId: string;
  agentId?: string | null;
}): string {
  return path.join(
    resolveAgentTaskRuntimeDir(params.agentId ?? undefined),
    `${params.taskId}.trajectory.json`,
  );
}

export function resolveAgentTaskTrajectoryRef(params: {
  taskId: string;
  agentId?: string | null;
}): string {
  return resolveStateRelativeRef(resolveAgentTaskTrajectoryPath(params));
}

type ResolvedSessionTaskState = {
  agentId?: string;
  sessionId?: string;
  sessionFile?: string;
  sessionKey?: string;
  storePath?: string;
};

function resolveSessionTaskState(params: {
  agentId?: string | null;
  sessionId?: string | null;
  sessionFile?: string | null;
  sessionKey?: string | null;
  storePath?: string | null;
}): ResolvedSessionTaskState {
  const sessionKey = normalizeOptionalString(params.sessionKey);
  const agentId = normalizeOptionalAgentId(
    params.agentId ?? parseAgentSessionKey(sessionKey)?.agentId,
  );
  const storePath =
    normalizeOptionalString(params.storePath) ??
    (agentId ? resolveStorePath(undefined, { agentId }) : undefined);
  let sessionId = normalizeOptionalString(params.sessionId);
  let sessionFile = normalizeOptionalString(params.sessionFile);
  if ((!sessionId || !sessionFile) && sessionKey && storePath) {
    const store = loadSessionStore(storePath);
    const resolved = resolveSessionStoreEntry({
      store,
      sessionKey,
    });
    sessionId ??= normalizeOptionalString(resolved.existing?.sessionId);
    sessionFile ??= normalizeOptionalString(resolved.existing?.sessionFile);
  }
  return {
    agentId,
    sessionId,
    sessionFile,
    sessionKey,
    storePath,
  };
}

function resolveTranscriptPath(params: ResolvedSessionTaskState): string | undefined {
  if (!params.sessionId) {
    return undefined;
  }
  try {
    return resolveSessionFilePath(
      params.sessionId,
      params.sessionFile ? { sessionFile: params.sessionFile } : undefined,
      resolveSessionFilePathOptions({
        agentId: params.agentId,
        storePath: params.storePath,
      }),
    );
  } catch {
    return undefined;
  }
}

function normalizeAgentTaskRuntimeMetadata(value: unknown): AgentTaskRuntimeMetadata | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== AGENT_TASK_RUNTIME_METADATA_VERSION) {
    return undefined;
  }
  const taskId = normalizeOptionalString(
    typeof record.taskId === "string" ? record.taskId : undefined,
  );
  const runtime =
    record.runtime === "subagent" ||
    record.runtime === "acp" ||
    record.runtime === "cli" ||
    record.runtime === "cron"
      ? record.runtime
      : undefined;
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : undefined;
  if (!taskId || !runtime || updatedAt == null) {
    return undefined;
  }
  const mode =
    record.mode === "foreground" || record.mode === "background" ? record.mode : undefined;
  return {
    version: AGENT_TASK_RUNTIME_METADATA_VERSION,
    taskId,
    runtime,
    updatedAt,
    ...(normalizeOptionalAgentId(typeof record.agentId === "string" ? record.agentId : undefined)
      ? { agentId: normalizeOptionalAgentId(record.agentId as string) }
      : {}),
    ...(normalizeOptionalAgentId(
      typeof record.parentAgentId === "string" ? record.parentAgentId : undefined,
    )
      ? { parentAgentId: normalizeOptionalAgentId(record.parentAgentId as string) }
      : {}),
    ...(mode ? { mode } : {}),
    ...(normalizeOptionalString(
      typeof record.spawnSource === "string" ? record.spawnSource : undefined,
    )
      ? { spawnSource: normalizeOptionalString(record.spawnSource as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.sessionKey === "string" ? record.sessionKey : undefined,
    )
      ? { sessionKey: normalizeOptionalString(record.sessionKey as string) }
      : {}),
    ...(normalizeOptionalString(typeof record.sessionId === "string" ? record.sessionId : undefined)
      ? { sessionId: normalizeOptionalString(record.sessionId as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.sessionFile === "string" ? record.sessionFile : undefined,
    )
      ? { sessionFile: normalizeOptionalString(record.sessionFile as string) }
      : {}),
    ...(normalizeOptionalString(typeof record.storePath === "string" ? record.storePath : undefined)
      ? { storePath: normalizeOptionalString(record.storePath as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.transcriptPath === "string" ? record.transcriptPath : undefined,
    )
      ? { transcriptPath: normalizeOptionalString(record.transcriptPath as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.transcriptRef === "string" ? record.transcriptRef : undefined,
    )
      ? { transcriptRef: normalizeOptionalString(record.transcriptRef as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.trajectoryRef === "string" ? record.trajectoryRef : undefined,
    )
      ? { trajectoryRef: normalizeOptionalString(record.trajectoryRef as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.capabilitySnapshotRef === "string" ? record.capabilitySnapshotRef : undefined,
    )
      ? {
          capabilitySnapshotRef: normalizeOptionalString(record.capabilitySnapshotRef as string),
        }
      : {}),
    ...(normalizeOptionalString(
      typeof record.requesterSessionKey === "string" ? record.requesterSessionKey : undefined,
    )
      ? { requesterSessionKey: normalizeOptionalString(record.requesterSessionKey as string) }
      : {}),
    ...(normalizeOptionalString(typeof record.runId === "string" ? record.runId : undefined)
      ? { runId: normalizeOptionalString(record.runId as string) }
      : {}),
    ...(normalizeOptionalString(typeof record.label === "string" ? record.label : undefined)
      ? { label: normalizeOptionalString(record.label as string) }
      : {}),
    ...(normalizeOptionalString(typeof record.task === "string" ? record.task : undefined)
      ? { task: normalizeOptionalString(record.task as string) }
      : {}),
  };
}

export function readAgentTaskRuntimeMetadataSync(
  runtimeStateRef: string | null | undefined,
): AgentTaskRuntimeMetadata | undefined {
  const ref = normalizeOptionalString(runtimeStateRef);
  if (!ref) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(resolveAbsoluteFromStateRef(ref), "utf8");
    return normalizeAgentTaskRuntimeMetadata(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function buildAgentTaskMetadataPatch(params: {
  current?: AgentTaskMetadata;
  parentAgentId?: string;
  mode?: AgentTaskMode;
  transcriptRef?: string;
  runtimeStateRef: string;
  trajectoryRef?: string;
  capabilitySnapshotRef?: string;
  spawnSource?: string;
}): AgentTaskMetadata | undefined {
  return normalizeAgentTaskMetadata({
    ...params.current,
    ...(params.parentAgentId ? { parentAgentId: params.parentAgentId } : {}),
    ...(params.mode ? { mode: params.mode } : {}),
    ...(params.transcriptRef ? { transcriptRef: params.transcriptRef } : {}),
    runtimeStateRef: params.runtimeStateRef,
    ...(params.trajectoryRef ? { trajectoryRef: params.trajectoryRef } : {}),
    ...(params.capabilitySnapshotRef
      ? { capabilitySnapshotRef: params.capabilitySnapshotRef }
      : {}),
    ...(params.spawnSource ? { spawnSource: params.spawnSource } : {}),
  });
}

export async function upsertAgentTaskRuntimeMetadata(params: {
  taskId: string;
  runtime: TaskRuntime;
  agentId?: string | null;
  parentAgentId?: string | null;
  mode?: AgentTaskMode;
  spawnSource?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  sessionFile?: string | null;
  storePath?: string | null;
  capabilitySnapshot?: AgentCapabilitySnapshotInput;
  requesterSessionKey?: string | null;
  runId?: string | null;
  label?: string | null;
  task?: string | null;
}): Promise<{ task: TaskRecord | null; metadata: AgentTaskRuntimeMetadata }> {
  const currentTask = getTaskById(params.taskId);
  const sessionKey =
    normalizeOptionalString(params.sessionKey) ??
    normalizeOptionalString(currentTask?.childSessionKey);
  const requesterSessionKey =
    normalizeOptionalString(params.requesterSessionKey) ??
    normalizeOptionalString(currentTask?.requesterSessionKey);
  const parentAgentId = normalizeOptionalAgentId(
    params.parentAgentId ??
      currentTask?.agentMetadata?.parentAgentId ??
      parseAgentSessionKey(requesterSessionKey)?.agentId,
  );
  const mode = params.mode ?? currentTask?.agentMetadata?.mode;
  const sessionTaskState = resolveSessionTaskState({
    agentId: params.agentId ?? currentTask?.agentId,
    sessionId: params.sessionId,
    sessionFile: params.sessionFile,
    sessionKey,
    storePath: params.storePath,
  });
  const transcriptPath = resolveTranscriptPath(sessionTaskState);
  const transcriptRef = transcriptPath ? resolveStateRelativeRef(transcriptPath) : undefined;
  const runtimeStateRef = resolveAgentTaskRuntimeStateRef({
    taskId: params.taskId,
    agentId: sessionTaskState.agentId,
  });
  const trajectoryRef = resolveAgentTaskTrajectoryRef({
    taskId: params.taskId,
    agentId: sessionTaskState.agentId,
  });
  const capabilitySnapshotRef = params.capabilitySnapshot
    ? (
        await writeAgentTaskCapabilitySnapshot({
          taskId: params.taskId,
          agentId: sessionTaskState.agentId,
          snapshot: params.capabilitySnapshot,
        })
      ).ref
    : currentTask?.agentMetadata?.capabilitySnapshotRef;
  const metadata: AgentTaskRuntimeMetadata = {
    version: AGENT_TASK_RUNTIME_METADATA_VERSION,
    taskId: params.taskId,
    runtime: params.runtime,
    updatedAt: Date.now(),
    ...(sessionTaskState.agentId ? { agentId: sessionTaskState.agentId } : {}),
    ...(parentAgentId ? { parentAgentId } : {}),
    ...(mode ? { mode } : {}),
    ...(normalizeOptionalString(params.spawnSource)
      ? { spawnSource: normalizeOptionalString(params.spawnSource) }
      : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(sessionTaskState.sessionId ? { sessionId: sessionTaskState.sessionId } : {}),
    ...(sessionTaskState.sessionFile ? { sessionFile: sessionTaskState.sessionFile } : {}),
    ...(sessionTaskState.storePath ? { storePath: sessionTaskState.storePath } : {}),
    ...(transcriptPath ? { transcriptPath } : {}),
    ...(transcriptRef ? { transcriptRef } : {}),
    ...(trajectoryRef ? { trajectoryRef } : {}),
    ...(capabilitySnapshotRef ? { capabilitySnapshotRef } : {}),
    ...(requesterSessionKey ? { requesterSessionKey } : {}),
    ...(normalizeOptionalString(params.runId)
      ? { runId: normalizeOptionalString(params.runId) }
      : {}),
    ...(normalizeOptionalString(params.label)
      ? { label: normalizeOptionalString(params.label) }
      : {}),
    ...(normalizeOptionalString(params.task) ? { task: normalizeOptionalString(params.task) } : {}),
  };
  await writeJsonAtomic(resolveAbsoluteFromStateRef(runtimeStateRef), metadata, {
    trailingNewline: true,
  });
  const nextTask = mergeTaskAgentMetadataById({
    taskId: params.taskId,
    agentMetadata: buildAgentTaskMetadataPatch({
      current: currentTask?.agentMetadata,
      parentAgentId,
      mode,
      transcriptRef,
      runtimeStateRef,
      trajectoryRef,
      capabilitySnapshotRef,
      spawnSource: normalizeOptionalString(params.spawnSource),
    }),
  });
  return {
    task: nextTask,
    metadata,
  };
}

export function resolveAgentTaskResumeTargetBySessionId(
  sessionId: string,
): AgentTaskResumeTarget | undefined {
  const trimmedSessionId = normalizeOptionalString(sessionId);
  if (!trimmedSessionId) {
    return undefined;
  }
  const tasks = listTaskRecords()
    .filter((task) => Boolean(task.agentMetadata?.runtimeStateRef?.trim()))
    .toSorted((left, right) => resolveTaskRecency(right) - resolveTaskRecency(left));
  for (const task of tasks) {
    const metadata = readAgentTaskRuntimeMetadataSync(task.agentMetadata?.runtimeStateRef);
    if (!metadata || metadata.sessionId !== trimmedSessionId) {
      continue;
    }
    const sessionKey =
      normalizeOptionalString(metadata.sessionKey) ?? normalizeOptionalString(task.childSessionKey);
    if (!sessionKey) {
      continue;
    }
    const agentId = normalizeOptionalAgentId(
      metadata.agentId ?? task.agentId ?? parseAgentSessionKey(sessionKey)?.agentId,
    );
    return {
      task,
      metadata,
      sessionKey,
      ...(agentId ? { agentId } : {}),
      ...(normalizeOptionalString(metadata.storePath)
        ? { storePath: normalizeOptionalString(metadata.storePath) }
        : agentId
          ? { storePath: resolveStorePath(undefined, { agentId }) }
          : {}),
    };
  }
  return undefined;
}

export { readAgentTaskCapabilitySnapshotSync };
