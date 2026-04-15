import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { writeJsonAtomic } from "../../infra/json-files.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import type { AgentTaskMode, TaskRuntime } from "../../tasks/task-registry.types.js";

const AGENT_CAPABILITY_SNAPSHOT_VERSION = 1;

export type AgentCapabilitySnapshot = {
  version: 1;
  taskId: string;
  runtime: TaskRuntime;
  updatedAt: number;
  agentId?: string;
  parentAgentId?: string;
  mode?: AgentTaskMode;
  spawnSource?: string;
  model?: string;
  sandboxed?: boolean;
  workspaceDir?: string;
  requesterSessionKey?: string;
  requesterAgentIdOverride?: string;
};

export type AgentCapabilitySnapshotInput = {
  runtime: TaskRuntime;
  agentId?: string | null;
  parentAgentId?: string | null;
  mode?: AgentTaskMode;
  spawnSource?: string | null;
  model?: string | null;
  sandboxed?: boolean;
  workspaceDir?: string | null;
  requesterSessionKey?: string | null;
  requesterAgentIdOverride?: string | null;
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

export function resolveAgentTaskCapabilitySnapshotPath(params: {
  taskId: string;
  agentId?: string | null;
}): string {
  return path.join(
    resolveAgentTaskRuntimeDir(params.agentId ?? undefined),
    `${params.taskId}.capabilities.json`,
  );
}

export function resolveAgentTaskCapabilitySnapshotRef(params: {
  taskId: string;
  agentId?: string | null;
}): string {
  return resolveStateRelativeRef(resolveAgentTaskCapabilitySnapshotPath(params));
}

export function normalizeAgentCapabilitySnapshot(
  value: unknown,
): AgentCapabilitySnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== AGENT_CAPABILITY_SNAPSHOT_VERSION) {
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
    version: AGENT_CAPABILITY_SNAPSHOT_VERSION,
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
    ...(normalizeOptionalString(typeof record.model === "string" ? record.model : undefined)
      ? { model: normalizeOptionalString(record.model as string) }
      : {}),
    ...(record.sandboxed === true ? { sandboxed: true } : {}),
    ...(normalizeOptionalString(
      typeof record.workspaceDir === "string" ? record.workspaceDir : undefined,
    )
      ? { workspaceDir: normalizeOptionalString(record.workspaceDir as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.requesterSessionKey === "string" ? record.requesterSessionKey : undefined,
    )
      ? { requesterSessionKey: normalizeOptionalString(record.requesterSessionKey as string) }
      : {}),
    ...(normalizeOptionalString(
      typeof record.requesterAgentIdOverride === "string"
        ? record.requesterAgentIdOverride
        : undefined,
    )
      ? {
          requesterAgentIdOverride: normalizeOptionalString(
            record.requesterAgentIdOverride as string,
          ),
        }
      : {}),
  };
}

export function createAgentCapabilitySnapshot(params: {
  taskId: string;
  snapshot: AgentCapabilitySnapshotInput;
}): AgentCapabilitySnapshot {
  return {
    version: AGENT_CAPABILITY_SNAPSHOT_VERSION,
    taskId: params.taskId,
    runtime: params.snapshot.runtime,
    updatedAt: Date.now(),
    ...(normalizeOptionalAgentId(params.snapshot.agentId)
      ? { agentId: normalizeOptionalAgentId(params.snapshot.agentId) }
      : {}),
    ...(normalizeOptionalAgentId(params.snapshot.parentAgentId)
      ? { parentAgentId: normalizeOptionalAgentId(params.snapshot.parentAgentId) }
      : {}),
    ...(params.snapshot.mode ? { mode: params.snapshot.mode } : {}),
    ...(normalizeOptionalString(params.snapshot.spawnSource)
      ? { spawnSource: normalizeOptionalString(params.snapshot.spawnSource) }
      : {}),
    ...(normalizeOptionalString(params.snapshot.model)
      ? { model: normalizeOptionalString(params.snapshot.model) }
      : {}),
    ...(params.snapshot.sandboxed === true ? { sandboxed: true } : {}),
    ...(normalizeOptionalString(params.snapshot.workspaceDir)
      ? { workspaceDir: normalizeOptionalString(params.snapshot.workspaceDir) }
      : {}),
    ...(normalizeOptionalString(params.snapshot.requesterSessionKey)
      ? { requesterSessionKey: normalizeOptionalString(params.snapshot.requesterSessionKey) }
      : {}),
    ...(normalizeOptionalString(params.snapshot.requesterAgentIdOverride)
      ? {
          requesterAgentIdOverride: normalizeOptionalString(
            params.snapshot.requesterAgentIdOverride,
          ),
        }
      : {}),
  };
}

export async function writeAgentTaskCapabilitySnapshot(params: {
  taskId: string;
  agentId?: string | null;
  snapshot: AgentCapabilitySnapshotInput;
}): Promise<{ ref: string; snapshot: AgentCapabilitySnapshot }> {
  const snapshot = createAgentCapabilitySnapshot({
    taskId: params.taskId,
    snapshot: params.snapshot,
  });
  const ref = resolveAgentTaskCapabilitySnapshotRef({
    taskId: params.taskId,
    agentId: params.agentId,
  });
  await writeJsonAtomic(resolveAbsoluteFromStateRef(ref), snapshot, {
    trailingNewline: true,
  });
  return { ref, snapshot };
}

export function readAgentTaskCapabilitySnapshotSync(
  snapshotRef: string | null | undefined,
): AgentCapabilitySnapshot | undefined {
  const ref = normalizeOptionalString(snapshotRef);
  if (!ref) {
    return undefined;
  }
  try {
    const raw = fs.readFileSync(resolveAbsoluteFromStateRef(ref), "utf8");
    return normalizeAgentCapabilitySnapshot(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
