import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import type { CrawClawConfig } from "../../config/config.js";
import { resolveStorePath } from "../../config/sessions/paths.js";
import { readSessionStoreReadOnly } from "../../config/sessions/store-read.js";
import { listGatewayAgentsBasic } from "../../gateway/agent-list.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { getTaskRegistrySummary, listTaskRecords } from "../../tasks/runtime-internal.js";
import {
  createEmptyTaskRegistrySummary,
  summarizeTaskRecords,
} from "../../tasks/task-registry.summary.js";
import type { TaskRegistrySummary } from "../../tasks/task-registry.types.js";
import { readTaskTrajectorySync } from "../tasks/task-trajectory.js";
import { inspectAgentRuntime } from "./agent-inspection.js";
import { readAgentTaskRuntimeMetadataSync } from "./agent-metadata-store.js";
import type { AgentRuntimeState, AgentRuntimeStatus } from "./agent-runtime-state.js";
import { listAgentRuntimeStates } from "./agent-runtime-state.js";

const ACTIVE_RUNTIME_STATUSES = new Set<AgentRuntimeStatus>(["created", "running", "waiting"]);
const STALE_RUNTIME_THRESHOLD_MS = 5 * 60 * 1000;

export type AgentRuntimeStatusCounts = Record<AgentRuntimeStatus, number>;

export type AgentOpsSummaryRow = {
  id: string;
  name?: string;
  isDefault: boolean;
  workspaceDir: string | null;
  bootstrapPending: boolean | null;
  sessionsPath: string;
  sessionsCount: number;
  lastUpdatedAt: number | null;
  lastActiveAgeMs: number | null;
  taskSummary: TaskRegistrySummary;
  runtimeSummary: {
    total: number;
    active: number;
    stale: number;
    byStatus: AgentRuntimeStatusCounts;
  };
  guardBlockers: Array<{ key: string; count: number }>;
  completionBlockers: Array<{ key: string; count: number }>;
  loopWarnings: Array<{ key: string; count: number }>;
};

export type AgentOpsSummary = {
  generatedAt: number;
  defaultId: string;
  taskSummary: TaskRegistrySummary;
  runtimeSummary: {
    total: number;
    active: number;
    stale: number;
    byStatus: AgentRuntimeStatusCounts;
  };
  agents: AgentOpsSummaryRow[];
};

function createEmptyRuntimeStatusCounts(): AgentRuntimeStatusCounts {
  return {
    created: 0,
    running: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAgentKey(agentId: string | null | undefined, defaultId: string): string {
  return normalizeAgentId(agentId ?? defaultId);
}

function incrementCounter(map: Map<string, number>, key: string | undefined): void {
  const normalized = normalizeOptionalString(key);
  if (!normalized) {
    return;
  }
  map.set(normalized, (map.get(normalized) ?? 0) + 1);
}

function sortCounts(map: Map<string, number>): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .toSorted((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function buildLocalAgentStatus(cfg: CrawClawConfig, agentId: string) {
  const workspaceDir = (() => {
    try {
      return resolveAgentWorkspaceDir(cfg, agentId);
    } catch {
      return null;
    }
  })();
  const bootstrapPath = workspaceDir != null ? path.join(workspaceDir, "BOOTSTRAP.md") : null;
  const bootstrapPending = bootstrapPath != null ? await fileExists(bootstrapPath) : null;
  const sessionsPath = resolveStorePath(cfg.session?.store, { agentId });
  const store = readSessionStoreReadOnly(sessionsPath);
  const sessions = Object.entries(store)
    .filter(([key]) => key !== "global" && key !== "unknown")
    .map(([, entry]) => entry);
  const lastUpdatedAt = sessions.reduce((max, entry) => Math.max(max, entry?.updatedAt ?? 0), 0);
  const resolvedLastUpdatedAt = lastUpdatedAt > 0 ? lastUpdatedAt : null;
  const now = Date.now();
  return {
    workspaceDir,
    bootstrapPending,
    sessionsPath,
    sessionsCount: sessions.length,
    lastUpdatedAt: resolvedLastUpdatedAt,
    lastActiveAgeMs: resolvedLastUpdatedAt ? now - resolvedLastUpdatedAt : null,
  };
}

function summarizeRuntimeStates(states: AgentRuntimeState[]): {
  total: number;
  active: number;
  stale: number;
  byStatus: AgentRuntimeStatusCounts;
} {
  const byStatus = createEmptyRuntimeStatusCounts();
  const now = Date.now();
  let active = 0;
  let stale = 0;
  for (const state of states) {
    byStatus[state.status] += 1;
    if (ACTIVE_RUNTIME_STATUSES.has(state.status)) {
      active += 1;
      const lastActivity =
        state.lastHeartbeat ?? state.updatedAt ?? state.startedAt ?? state.createdAt;
      if (now - lastActivity >= STALE_RUNTIME_THRESHOLD_MS) {
        stale += 1;
      }
    }
  }
  return {
    total: states.length,
    active,
    stale,
    byStatus,
  };
}

function resolveCompletionBlocker(params: {
  trajectoryRef?: string;
  runtimeStateRef?: string;
}): string | undefined {
  const trajectoryRef =
    params.trajectoryRef ?? readAgentTaskRuntimeMetadataSync(params.runtimeStateRef)?.trajectoryRef;
  return readTaskTrajectorySync(trajectoryRef)?.completion?.blockingState;
}

export async function buildAgentOpsSummary(cfg: CrawClawConfig): Promise<AgentOpsSummary> {
  const defaultId = normalizeAgentId(resolveDefaultAgentId(cfg));
  const gatewayAgents = listGatewayAgentsBasic(cfg);
  const tasks = listTaskRecords();
  const runtimeStates = listAgentRuntimeStates();
  const overallRuntimeSummary = summarizeRuntimeStates(runtimeStates);

  const agents: AgentOpsSummaryRow[] = [];
  for (const agent of gatewayAgents.agents) {
    const agentId = normalizeAgentId(agent.id);
    const agentTasks = tasks.filter(
      (task) => normalizeAgentKey(task.agentId, defaultId) === agentId,
    );
    const agentRuntimeStates = runtimeStates.filter(
      (state) => normalizeAgentKey(state.agentId, defaultId) === agentId,
    );
    const guardBlockers = new Map<string, number>();
    const loopWarnings = new Map<string, number>();
    for (const state of agentRuntimeStates) {
      const inspection = inspectAgentRuntime({ runId: state.runId });
      incrementCounter(guardBlockers, inspection?.guard?.interactiveApprovalBlocker);
      for (const warning of inspection?.loop?.warningBuckets ?? []) {
        loopWarnings.set(warning.key, (loopWarnings.get(warning.key) ?? 0) + warning.count);
      }
    }

    const completionBlockers = new Map<string, number>();
    for (const task of agentTasks) {
      incrementCounter(
        completionBlockers,
        resolveCompletionBlocker({
          trajectoryRef: task.agentMetadata?.trajectoryRef,
          runtimeStateRef: task.agentMetadata?.runtimeStateRef,
        }),
      );
    }

    agents.push({
      id: agentId,
      name: agent.name,
      isDefault: agentId === gatewayAgents.defaultId,
      ...(await buildLocalAgentStatus(cfg, agentId)),
      taskSummary:
        agentTasks.length > 0 ? summarizeTaskRecords(agentTasks) : createEmptyTaskRegistrySummary(),
      runtimeSummary: summarizeRuntimeStates(agentRuntimeStates),
      guardBlockers: sortCounts(guardBlockers),
      completionBlockers: sortCounts(completionBlockers),
      loopWarnings: sortCounts(loopWarnings),
    });
  }

  return {
    generatedAt: Date.now(),
    defaultId: gatewayAgents.defaultId,
    taskSummary: getTaskRegistrySummary(),
    runtimeSummary: overallRuntimeSummary,
    agents,
  };
}
