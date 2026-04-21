import { getAgentRunContext, type AgentRunContext } from "../../infra/agent-events.js";
import {
  type ChannelStreamingDecisionSnapshot,
  peekDiagnosticSessionState,
  type SessionState,
} from "../../logging/diagnostic-session-state.js";
import { findTaskByRunId, getTaskById } from "../../tasks/runtime-internal.js";
import type { TaskRecord } from "../../tasks/task-registry.types.js";
import type { ContextArchiveInspectionSnapshot } from "../context-archive/types.js";
import { readTaskTrajectorySync, type TaskTrajectory } from "../tasks/task-trajectory.js";
import type { AgentCapabilitySnapshot } from "./agent-capability-snapshot.js";
import { resolveAgentGuardContext, type AgentGuardContext } from "./agent-guard-context.js";
import {
  readAgentTaskCapabilitySnapshotSync,
  readAgentTaskRuntimeMetadataSync,
  type AgentTaskRuntimeMetadata,
} from "./agent-metadata-store.js";
import {
  getAgentRuntimeState,
  listAgentRuntimeStates,
  type AgentRuntimeState,
} from "./agent-runtime-state.js";

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export type AgentInspectionLoopSummary = {
  progressCount: number;
  lastProgressAt?: number;
  lastProgressTool?: string;
  lastProgressStateDelta?: string;
  warningBuckets: Array<{ key: string; count: number }>;
  commandPolls: Array<{ key: string; count: number; lastPollAt: number }>;
};

export type AgentInspectionTimelineEntry = {
  eventId: string;
  type: string;
  phase?: string;
  createdAt: number;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string | null;
  status?: string;
  decisionCode?: string;
  decisionSummary?: string;
  summary: string;
  metrics?: Record<string, number>;
  refs?: Record<string, string | number | boolean | null>;
};

export type AgentInspectionSnapshot = {
  lookup: {
    runId?: string;
    taskId?: string;
  };
  runId?: string;
  taskId?: string;
  runtimeState?: AgentRuntimeState;
  runContext?: AgentRunContext;
  task?: TaskRecord;
  runtimeMetadata?: AgentTaskRuntimeMetadata;
  capabilitySnapshot?: AgentCapabilitySnapshot;
  trajectory?: TaskTrajectory;
  completion?: TaskTrajectory["completion"];
  guard?: AgentGuardContext;
  loop?: AgentInspectionLoopSummary;
  channelStreaming?: {
    recentDecisions: ChannelStreamingDecisionSnapshot[];
  };
  archive?: ContextArchiveInspectionSnapshot;
  timeline?: AgentInspectionTimelineEntry[];
  queryContext?: {
    archiveRunId: string;
    eventId: string;
    queryContextHash?: string;
    bootstrapFiles?: string[];
    skillNames?: string[];
    memorySources?: string[];
    systemContextSectionCount?: number;
    decisionCodes?: Record<string, string>;
    sectionTokenUsage?: {
      totalEstimatedTokens?: number;
      byRole?: Record<string, number>;
      byType?: Record<string, number>;
    };
    hookMutations?: Array<{
      hook: string;
      prependUserContextSections: number;
      appendUserContextSections: number;
      prependSystemContextSections: number;
      appendSystemContextSections: number;
      replaceSystemPromptSections: number;
      clearSystemContextSections: boolean;
      replaceUserPrompt: boolean;
    }>;
    memoryRecall?: {
      selectedItemIds?: string[];
      omittedItemIds?: string[];
      selectedDurableDetails?: Array<{
        itemId: string;
        notePath: string;
        title: string;
        provenance: string[];
        scoreBreakdown?: Record<string, number>;
      }>;
      omittedDurableDetails?: Array<{
        itemId: string;
        notePath: string;
        title: string;
        provenance: string[];
        omittedReason?: string;
        scoreBreakdown?: Record<string, number>;
      }>;
      recentDreamTouchedNotes?: string[];
      hitReason?: string;
      evictionReason?: string;
      durableRecallSource?: string;
      decisionCodes?: Record<string, string>;
    };
    providerRequestSnapshot?: {
      queryContextHash: string;
      promptChars: number;
      systemPromptChars: number;
      decisionCodes?: Record<string, string>;
      sectionTokenUsage: {
        totalEstimatedTokens: number;
        byRole: Record<string, number>;
        byType: Record<string, number>;
      };
      sectionOrder: Array<{
        id: string;
        role: string;
        sectionType: string;
        estimatedTokens: number;
        source?: string;
      }>;
    };
  };
  dream?: {
    scopeKey: string;
    enabled?: boolean;
    transcriptFallback?: {
      enabled: boolean;
      maxSessions?: number;
      maxMatchesPerSession?: number;
      maxTotalBytes?: number;
      maxExcerptChars?: number;
    };
    closedLoopActive?: boolean;
    closedLoopReason?: string;
    state?: {
      lastSuccessAt: number | null;
      lastAttemptAt: number | null;
      lastFailureAt: number | null;
      lastSkipReason: string | null;
      lockOwner: string | null;
    };
    recentRuns: Array<{
      id: string;
      status: string;
      summary: string | null;
      triggerSource: string | null;
      reason?: string | null;
      touchedNotes?: string[];
    }>;
  };
  sessionSummary?: {
    sessionId: string;
    agentId: string;
    path: string;
    exists: boolean;
    updatedAt: number | null;
    state?: {
      lastSummarizedMessageId: string | null;
      lastSummaryUpdatedAt: number | null;
      tokensAtLastSummary: number;
      summaryInProgress: boolean;
    };
  };
  refs: {
    runtimeStateRef?: string;
    transcriptRef?: string;
    trajectoryRef?: string;
    capabilitySnapshotRef?: string;
  };
  warnings: string[];
};

function resolveInspectionRunState(params: {
  runId?: string;
  taskId?: string;
}): AgentRuntimeState | undefined {
  const runId = normalizeOptionalString(params.runId);
  if (runId) {
    return getAgentRuntimeState(runId);
  }
  const taskId = normalizeOptionalString(params.taskId);
  if (!taskId) {
    return undefined;
  }
  return listAgentRuntimeStates().find((entry) => entry.taskId === taskId);
}

function resolveInspectionTask(params: {
  runId?: string;
  taskId?: string;
  runtimeState?: AgentRuntimeState;
  runContext?: AgentRunContext;
}): TaskRecord | undefined {
  const explicitTaskId = normalizeOptionalString(params.taskId);
  if (explicitTaskId) {
    return getTaskById(explicitTaskId);
  }
  const taskIdFromRuntime = normalizeOptionalString(params.runtimeState?.taskId);
  if (taskIdFromRuntime) {
    return getTaskById(taskIdFromRuntime);
  }
  const taskIdFromContext = normalizeOptionalString(params.runContext?.taskId);
  if (taskIdFromContext) {
    return getTaskById(taskIdFromContext);
  }
  const runId = normalizeOptionalString(params.runId);
  if (!runId) {
    return undefined;
  }
  return findTaskByRunId(runId) ?? undefined;
}

function summarizeLoopState(
  state: SessionState | undefined,
): AgentInspectionLoopSummary | undefined {
  if (!state) {
    return undefined;
  }
  const progressHistory = state.loopProgressHistory ?? [];
  const lastProgress = progressHistory.at(-1);
  const warningBuckets = [...(state.toolLoopWarningBuckets?.entries() ?? [])]
    .map(([key, count]) => ({ key, count }))
    .toSorted((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  const commandPolls = [...(state.commandPollCounts?.entries() ?? [])]
    .map(([key, value]) => ({
      key,
      count: value.count,
      lastPollAt: value.lastPollAt,
    }))
    .toSorted((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  if (progressHistory.length === 0 && warningBuckets.length === 0 && commandPolls.length === 0) {
    return undefined;
  }
  return {
    progressCount: progressHistory.length,
    ...(typeof lastProgress?.timestamp === "number"
      ? { lastProgressAt: lastProgress.timestamp }
      : {}),
    ...(normalizeOptionalString(lastProgress?.toolName)
      ? { lastProgressTool: lastProgress?.toolName }
      : {}),
    ...(normalizeOptionalString(lastProgress?.stateDelta)
      ? { lastProgressStateDelta: lastProgress?.stateDelta }
      : {}),
    warningBuckets,
    commandPolls,
  };
}

function summarizeChannelStreaming(
  state: SessionState | undefined,
): AgentInspectionSnapshot["channelStreaming"] | undefined {
  const decisions = state?.recentChannelStreamingDecisions ?? [];
  if (decisions.length === 0) {
    return undefined;
  }
  return {
    recentDecisions: [...decisions].toSorted((left, right) => right.ts - left.ts),
  };
}

export function mergeAgentInspectionArchive(
  snapshot: AgentInspectionSnapshot,
  archive: ContextArchiveInspectionSnapshot | undefined,
): AgentInspectionSnapshot {
  if (!archive || archive.runs.length === 0) {
    return snapshot;
  }
  return {
    ...snapshot,
    archive,
  };
}

export function inspectAgentRuntime(params: {
  runId?: string;
  taskId?: string;
}): AgentInspectionSnapshot | undefined {
  const lookupRunId = normalizeOptionalString(params.runId);
  const lookupTaskId = normalizeOptionalString(params.taskId);
  if (!lookupRunId && !lookupTaskId) {
    return undefined;
  }

  const runtimeState = resolveInspectionRunState({
    runId: lookupRunId,
    taskId: lookupTaskId,
  });
  const resolvedRunId = lookupRunId ?? normalizeOptionalString(runtimeState?.runId);
  const runContext = resolvedRunId ? getAgentRunContext(resolvedRunId) : undefined;
  const task = resolveInspectionTask({
    runId: resolvedRunId,
    taskId: lookupTaskId,
    runtimeState,
    runContext,
  });
  const resolvedTaskId =
    lookupTaskId ??
    normalizeOptionalString(task?.taskId) ??
    normalizeOptionalString(runtimeState?.taskId) ??
    normalizeOptionalString(runContext?.taskId);

  if (!resolvedRunId && !resolvedTaskId) {
    return undefined;
  }

  const warnings: string[] = [];
  const runtimeStateRef = task?.agentMetadata?.runtimeStateRef;
  const runtimeMetadata = readAgentTaskRuntimeMetadataSync(runtimeStateRef);
  if (runtimeStateRef && !runtimeMetadata) {
    warnings.push(`Runtime metadata missing or unreadable: ${runtimeStateRef}`);
  }

  const capabilitySnapshotRef =
    task?.agentMetadata?.capabilitySnapshotRef ?? runtimeMetadata?.capabilitySnapshotRef;
  const capabilitySnapshot = readAgentTaskCapabilitySnapshotSync(capabilitySnapshotRef);
  if (capabilitySnapshotRef && !capabilitySnapshot) {
    warnings.push(`Capability snapshot missing or unreadable: ${capabilitySnapshotRef}`);
  }

  const trajectoryRef = task?.agentMetadata?.trajectoryRef ?? runtimeMetadata?.trajectoryRef;
  const trajectory = readTaskTrajectorySync(trajectoryRef);
  if (trajectoryRef && !trajectory) {
    warnings.push(`Task trajectory missing or unreadable: ${trajectoryRef}`);
  }

  const sessionKey =
    normalizeOptionalString(runtimeState?.sessionKey) ??
    normalizeOptionalString(runContext?.sessionKey) ??
    normalizeOptionalString(runtimeMetadata?.sessionKey);
  const sessionId =
    normalizeOptionalString(runtimeState?.sessionId) ??
    normalizeOptionalString(runContext?.sessionId) ??
    normalizeOptionalString(runtimeMetadata?.sessionId);
  const diagnosticState = peekDiagnosticSessionState({
    ...(sessionId ? { sessionId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
  });
  const loop = summarizeLoopState(diagnosticState);
  const channelStreaming = summarizeChannelStreaming(diagnosticState);

  const finalRunId = resolvedRunId ?? normalizeOptionalString(runtimeMetadata?.runId);
  const guard = finalRunId
    ? resolveAgentGuardContext({
        runId: finalRunId,
        sandboxed: capabilitySnapshot?.sandboxed,
      })
    : undefined;

  if (!runtimeState) {
    warnings.push("Runtime state not found");
  }
  if (!task) {
    warnings.push("Task record not found");
  }

  return {
    lookup: {
      ...(lookupRunId ? { runId: lookupRunId } : {}),
      ...(lookupTaskId ? { taskId: lookupTaskId } : {}),
    },
    ...(finalRunId ? { runId: finalRunId } : {}),
    ...(resolvedTaskId ? { taskId: resolvedTaskId } : {}),
    ...(runtimeState ? { runtimeState } : {}),
    ...(runContext ? { runContext } : {}),
    ...(task ? { task } : {}),
    ...(runtimeMetadata ? { runtimeMetadata } : {}),
    ...(capabilitySnapshot ? { capabilitySnapshot } : {}),
    ...(trajectory ? { trajectory } : {}),
    ...(trajectory?.completion ? { completion: trajectory.completion } : {}),
    ...(guard ? { guard } : {}),
    ...(loop ? { loop } : {}),
    ...(channelStreaming ? { channelStreaming } : {}),
    refs: {
      ...(runtimeStateRef ? { runtimeStateRef } : {}),
      ...((task?.agentMetadata?.transcriptRef ?? runtimeMetadata?.transcriptRef)
        ? { transcriptRef: task?.agentMetadata?.transcriptRef ?? runtimeMetadata?.transcriptRef }
        : {}),
      ...(trajectoryRef ? { trajectoryRef } : {}),
      ...(capabilitySnapshotRef ? { capabilitySnapshotRef } : {}),
    },
    warnings,
  };
}
