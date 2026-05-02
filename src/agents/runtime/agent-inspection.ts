import { loadConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import {
  getAgentRunContext,
  listAgentRunContexts,
  type AgentRunContext,
} from "../../infra/agent-events.js";
import { backfillObservationIndex } from "../../infra/observation/history-index.js";
import type { ObservationContext } from "../../infra/observation/types.js";
import {
  type ChannelStreamingDecisionSnapshot,
  peekDiagnosticSessionState,
  type SessionState,
} from "../../logging/diagnostic-session-state.js";
import { resolveMemoryConfig } from "../../memory/config/resolve.js";
import type { RuntimeStore } from "../../memory/runtime/runtime-store.js";
import { SqliteRuntimeStore } from "../../memory/runtime/sqlite-runtime-store.js";
import type {
  ObservationEventIndexRow,
  ObservationRunIndexRow,
} from "../../memory/types/runtime.js";
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
  type AgentRuntimeStatus,
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
  source?: "lifecycle" | "diagnostic" | "action" | "archive" | "trajectory" | "log" | "otel";
  observation?: ObservationContext;
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
    traceId?: string;
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
      selectedExperienceDetails?: Array<{
        itemId: string;
        title: string;
        source: string;
        memoryKind?: string;
        providerOrder?: number;
        selectionReason?: string;
      }>;
      omittedExperienceDetails?: Array<{
        itemId: string;
        title: string;
        source: string;
        memoryKind?: string;
        omittedReason?: string;
        providerOrder?: number;
        selectionReason?: string;
      }>;
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
    closedLoopActive?: boolean;
    closedLoopReason?: string;
    state?: {
      lastConsolidatedAt: number | null;
      lockPath: string;
      lockActive: boolean;
      lockStale: boolean;
      lockOwner: string | null;
      lockAcquiredAt: number | null;
    };
    historyPersisted?: boolean;
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

export type ObservationSource =
  | "lifecycle"
  | "diagnostic"
  | "action"
  | "archive"
  | "trajectory"
  | "log"
  | "otel";

export type ObservationRunStatus = "running" | "ok" | "error" | "timeout" | "archived" | "unknown";

export type ObservationRunSummary = {
  runId?: string;
  taskId?: string;
  traceId: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  status: ObservationRunStatus;
  startedAt?: number;
  endedAt?: number;
  lastEventAt?: number;
  eventCount: number;
  errorCount: number;
  sources: ObservationSource[];
  summary: string;
};

export type ObservationRunListParams = {
  query?: string;
  status?: ObservationRunStatus;
  source?: ObservationSource;
  limit?: number;
  cursor?: string;
  from?: number;
  to?: number;
};

export type ObservationRunListResult = {
  items: ObservationRunSummary[];
  nextCursor?: string;
  generatedAt: number;
};

type ObservationHistoryDeps = {
  store?: RuntimeStore;
  skipBackfill?: boolean;
  stateDir?: string;
};

function resolveInspectionRunState(params: {
  runId?: string;
  taskId?: string;
  traceId?: string;
}): AgentRuntimeState | undefined {
  const runId = normalizeOptionalString(params.runId);
  if (runId) {
    return getAgentRuntimeState(runId);
  }
  const taskId = normalizeOptionalString(params.taskId);
  if (!taskId) {
    const traceId = normalizeOptionalString(params.traceId);
    if (!traceId) {
      return undefined;
    }
    const contextRun = listAgentRunContexts().find(
      (entry) => entry.context.observation.trace.traceId === traceId,
    );
    return contextRun ? getAgentRuntimeState(contextRun.runId) : undefined;
  }
  return listAgentRuntimeStates().find((entry) => entry.taskId === taskId);
}

function resolveRunIdFromTraceId(traceId: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(traceId);
  if (!normalized) {
    return undefined;
  }
  return listAgentRunContexts().find(
    (entry) => entry.context.observation.trace.traceId === normalized,
  )?.runId;
}

function mapRuntimeStatus(
  status: AgentRuntimeStatus | undefined,
  lastError?: string,
): ObservationRunStatus {
  if (lastError?.toLowerCase().includes("timeout")) {
    return "timeout";
  }
  switch (status) {
    case "running":
    case "waiting":
    case "created":
      return "running";
    case "completed":
      return "ok";
    case "failed":
      return "error";
    case "cancelled":
      return "unknown";
    default:
      return "unknown";
  }
}

function collectTimelineSources(
  timeline: AgentInspectionTimelineEntry[] | undefined,
  fallback: ObservationSource,
): ObservationSource[] {
  const sources = new Set<ObservationSource>();
  for (const entry of timeline ?? []) {
    if (entry.source) {
      sources.add(entry.source);
    }
  }
  if (sources.size === 0) {
    sources.add(fallback);
  }
  return [...sources].toSorted((left, right) => left.localeCompare(right));
}

function countTimelineErrors(timeline: AgentInspectionTimelineEntry[] | undefined): number {
  return (timeline ?? []).filter((entry) => {
    const status = entry.status?.toLowerCase() ?? "";
    return status === "error" || status === "failed" || status === "timeout";
  }).length;
}

function maxTimelineCreatedAt(
  timeline: AgentInspectionTimelineEntry[] | undefined,
): number | undefined {
  const values = (timeline ?? [])
    .map((entry) => entry.createdAt)
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : undefined;
}

function buildObservationRunSummary(params: {
  runId: string;
  runtimeState?: AgentRuntimeState;
  runContext?: AgentRunContext;
}): ObservationRunSummary | undefined {
  const observation = params.runContext?.observation;
  const traceId = normalizeOptionalString(observation?.trace.traceId);
  if (!traceId) {
    return undefined;
  }
  const inspection = inspectAgentRuntime({ runId: params.runId });
  const timeline = inspection?.timeline;
  const status = mapRuntimeStatus(params.runtimeState?.status, params.runtimeState?.lastError);
  const startedAt = params.runtimeState?.startedAt ?? params.runtimeState?.createdAt;
  const endedAt = params.runtimeState?.endedAt;
  const lastEventAt =
    maxTimelineCreatedAt(timeline) ??
    params.runtimeState?.endedAt ??
    params.runtimeState?.updatedAt ??
    startedAt;
  const eventCount = Math.max(1, timeline?.length ?? 0);
  const errorCount =
    countTimelineErrors(timeline) +
    (status === "error" || status === "timeout" || params.runtimeState?.lastError ? 1 : 0);
  const agentId =
    normalizeOptionalString(params.runtimeState?.agentId) ??
    normalizeOptionalString(params.runContext?.agentId);
  const sessionKey =
    normalizeOptionalString(params.runtimeState?.sessionKey) ??
    normalizeOptionalString(params.runContext?.sessionKey);
  const sessionId =
    normalizeOptionalString(params.runtimeState?.sessionId) ??
    normalizeOptionalString(params.runContext?.sessionId);
  const taskId =
    normalizeOptionalString(params.runtimeState?.taskId) ??
    normalizeOptionalString(params.runContext?.taskId) ??
    normalizeOptionalString(observation?.runtime.taskId);

  return {
    runId: params.runId,
    ...(taskId ? { taskId } : {}),
    traceId,
    ...(sessionId ? { sessionId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(agentId ? { agentId } : {}),
    status,
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(lastEventAt ? { lastEventAt } : {}),
    eventCount,
    errorCount,
    sources: collectTimelineSources(timeline, "lifecycle"),
    summary: `${status} ${agentId ?? "agent"} observation`,
  };
}

function observationSummaryMatchesQuery(
  summary: ObservationRunSummary,
  query: string | undefined,
): boolean {
  const normalized = normalizeOptionalString(query)?.toLowerCase();
  if (!normalized) {
    return true;
  }
  const values = [
    summary.runId,
    summary.taskId,
    summary.traceId,
    summary.sessionId,
    summary.sessionKey,
    summary.agentId,
  ];
  return values.some((value) => value?.toLowerCase().includes(normalized));
}

function listLiveObservationRunSummaries(
  params: ObservationRunListParams = {},
): ObservationRunListResult {
  const runtimeByRunId = new Map(listAgentRuntimeStates().map((state) => [state.runId, state]));
  const runIds = new Set<string>([
    ...runtimeByRunId.keys(),
    ...listAgentRunContexts().map((entry) => entry.runId),
  ]);
  const offset = Math.max(0, Number.parseInt(params.cursor ?? "0", 10) || 0);
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 50), 1), 200);
  const summaries = [...runIds]
    .map((runId) =>
      buildObservationRunSummary({
        runId,
        runtimeState: runtimeByRunId.get(runId),
        runContext: getAgentRunContext(runId),
      }),
    )
    .filter((summary): summary is ObservationRunSummary => Boolean(summary))
    .filter((summary) => (params.status ? summary.status === params.status : true))
    .filter((summary) => (params.source ? summary.sources.includes(params.source) : true))
    .filter((summary) => observationSummaryMatchesQuery(summary, params.query))
    .toSorted((left, right) => (right.lastEventAt ?? 0) - (left.lastEventAt ?? 0));
  const items = summaries.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    ...(nextOffset < summaries.length ? { nextCursor: String(nextOffset) } : {}),
    generatedAt: Date.now(),
  };
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseObservationSources(value: string): ObservationSource[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is ObservationSource =>
      ["lifecycle", "diagnostic", "action", "archive", "trajectory", "log", "otel"].includes(
        String(entry),
      ),
    );
  } catch {
    return [];
  }
}

function observationRunSummaryFromIndex(row: ObservationRunIndexRow): ObservationRunSummary {
  return {
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.taskId ? { taskId: row.taskId } : {}),
    traceId: row.traceId,
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.sessionKey ? { sessionKey: row.sessionKey } : {}),
    ...(row.agentId ? { agentId: row.agentId } : {}),
    status: row.status,
    ...(row.startedAt != null ? { startedAt: row.startedAt } : {}),
    ...(row.endedAt != null ? { endedAt: row.endedAt } : {}),
    ...(row.lastEventAt != null ? { lastEventAt: row.lastEventAt } : {}),
    eventCount: row.eventCount,
    errorCount: row.errorCount,
    sources: parseObservationSources(row.sourcesJson),
    summary: row.summary,
  };
}

function observationEventTimelineEntryFromIndex(
  row: ObservationEventIndexRow,
): AgentInspectionTimelineEntry | undefined {
  const observation = parseJsonRecord(row.observationJson) as ObservationContext | undefined;
  if (!observation) {
    return undefined;
  }
  const metrics = parseJsonRecord(row.metricsJson) as Record<string, number> | undefined;
  const refs = {
    ...parseJsonRecord(row.refsJson),
    ...parseJsonRecord(row.payloadRefJson),
  } as Record<string, string | number | boolean | null>;
  return {
    eventId: row.eventId,
    type: row.type,
    ...(row.phase ? { phase: row.phase } : {}),
    createdAt: row.createdAt,
    source: row.source,
    observation,
    traceId: observation.trace.traceId,
    spanId: observation.trace.spanId,
    parentSpanId: observation.trace.parentSpanId,
    ...(row.status ? { status: row.status } : {}),
    ...(row.decisionCode ? { decisionCode: row.decisionCode } : {}),
    summary: row.summary,
    ...(metrics && Object.keys(metrics).length > 0 ? { metrics } : {}),
    ...(Object.keys(refs).length > 0 ? { refs } : {}),
  };
}

async function withObservationHistoryStore<T>(
  deps: ObservationHistoryDeps | undefined,
  callback: (store: RuntimeStore) => Promise<T>,
): Promise<T | undefined> {
  if (deps?.store) {
    if (!deps.skipBackfill) {
      await backfillObservationIndex({
        store: deps.store,
        stateDir: deps.stateDir ?? resolveStateDir(),
      });
    }
    return await callback(deps.store);
  }
  let store: SqliteRuntimeStore | undefined;
  try {
    const config = loadConfig();
    const memoryConfig = resolveMemoryConfig(config.memory ?? {});
    store = new SqliteRuntimeStore(memoryConfig.runtimeStore.dbPath);
    await store.init();
    await backfillObservationIndex({ store, stateDir: deps?.stateDir ?? resolveStateDir() });
    return await callback(store);
  } catch {
    return undefined;
  } finally {
    await store?.close();
  }
}

export async function listObservationRunSummaries(
  params: ObservationRunListParams = {},
  deps?: ObservationHistoryDeps,
): Promise<ObservationRunListResult> {
  if (!deps) {
    return listLiveObservationRunSummaries(params);
  }
  return listObservationRunSummariesWithHistory(params, deps);
}

export async function listObservationRunSummariesWithHistory(
  params: ObservationRunListParams = {},
  deps?: ObservationHistoryDeps,
): Promise<ObservationRunListResult> {
  const historical = await withObservationHistoryStore(deps, async (store) => {
    const result = await store.listObservationRuns({
      ...(params.query ? { query: params.query } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(typeof params.limit === "number" ? { limit: params.limit } : {}),
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(typeof params.from === "number" ? { from: params.from } : {}),
      ...(typeof params.to === "number" ? { to: params.to } : {}),
    });
    return {
      items: result.items.map(observationRunSummaryFromIndex),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      generatedAt: Date.now(),
    };
  });
  if (historical && (historical.items.length > 0 || deps?.store)) {
    return historical;
  }
  return listLiveObservationRunSummaries(params);
}

function buildObservationTimeline(params: {
  runId?: string;
  runContext?: AgentRunContext;
  trajectory?: TaskTrajectory;
}): AgentInspectionTimelineEntry[] | undefined {
  const entries: AgentInspectionTimelineEntry[] = [];
  if (params.runContext?.observation) {
    const observation = params.runContext.observation;
    entries.push({
      eventId: `observation:${observation.trace.spanId}`,
      source: "lifecycle",
      type: "run.observation",
      ...(observation.phase ? { phase: observation.phase } : {}),
      createdAt: 0,
      observation,
      traceId: observation.trace.traceId,
      spanId: observation.trace.spanId,
      parentSpanId: observation.trace.parentSpanId,
      ...(observation.decisionCode ? { decisionCode: observation.decisionCode } : {}),
      summary: `run observation ${params.runId ?? observation.runtime.runId ?? "unknown"}`,
      ...(observation.refs ? { refs: observation.refs } : {}),
    });
  }
  if (params.trajectory) {
    for (const step of params.trajectory.steps) {
      entries.push({
        eventId: `trajectory:${step.stepId}`,
        source: "trajectory",
        type: `trajectory.${step.kind}`,
        createdAt: step.startedAt,
        ...(step.observationRef
          ? {
              traceId: step.observationRef.traceId,
              spanId: step.observationRef.spanId,
              parentSpanId: step.observationRef.parentSpanId,
            }
          : params.trajectory.observation
            ? {
                observation: params.trajectory.observation,
                traceId: params.trajectory.observation.trace.traceId,
                spanId: params.trajectory.observation.trace.spanId,
                parentSpanId: params.trajectory.observation.trace.parentSpanId,
              }
            : {}),
        status: step.status,
        summary: step.summary ?? step.title,
        refs: {
          stepId: step.stepId,
          ...(step.toolName ? { toolName: step.toolName } : {}),
          ...(step.toolCallId ? { toolCallId: step.toolCallId } : {}),
        },
      });
    }
  }
  const sorted = entries.toSorted((left, right) => left.createdAt - right.createdAt);
  return sorted.length > 0 ? sorted : undefined;
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
  traceId?: string;
}): AgentInspectionSnapshot | undefined {
  const lookupRunId = normalizeOptionalString(params.runId);
  const lookupTaskId = normalizeOptionalString(params.taskId);
  const lookupTraceId = normalizeOptionalString(params.traceId);
  if (!lookupRunId && !lookupTaskId && !lookupTraceId) {
    return undefined;
  }

  const runtimeState = resolveInspectionRunState({
    runId: lookupRunId,
    taskId: lookupTaskId,
    traceId: lookupTraceId,
  });
  const resolvedRunId =
    lookupRunId ??
    normalizeOptionalString(runtimeState?.runId) ??
    resolveRunIdFromTraceId(lookupTraceId);
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
      ...(lookupTraceId ? { traceId: lookupTraceId } : {}),
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
    ...(buildObservationTimeline({ runId: finalRunId, runContext, trajectory })
      ? { timeline: buildObservationTimeline({ runId: finalRunId, runContext, trajectory }) }
      : {}),
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

export async function inspectAgentRuntimeHistory(
  params: {
    runId?: string;
    taskId?: string;
    traceId?: string;
  },
  deps?: ObservationHistoryDeps,
): Promise<AgentInspectionSnapshot | undefined> {
  const live = inspectAgentRuntime(params);
  const historical = await withObservationHistoryStore(deps, async (store) => {
    const row = await store.getObservationRunByLookup(params);
    if (!row) {
      return undefined;
    }
    const events = await store.listObservationEvents(row.traceId, 10_000);
    const timeline = events
      .map(observationEventTimelineEntryFromIndex)
      .filter((entry): entry is AgentInspectionTimelineEntry => Boolean(entry));
    const lookup = {
      ...(params.runId ? { runId: params.runId } : {}),
      ...(params.taskId ? { taskId: params.taskId } : {}),
      ...(params.traceId ? { traceId: params.traceId } : {}),
    };
    const base = live ? { ...live } : {};
    return {
      ...base,
      lookup,
      ...(row.runId ? { runId: row.runId } : live?.runId ? { runId: live.runId } : {}),
      ...(row.taskId ? { taskId: row.taskId } : live?.taskId ? { taskId: live.taskId } : {}),
      ...(timeline.length > 0 ? { timeline } : live?.timeline ? { timeline: live.timeline } : {}),
      refs: live?.refs ?? {},
      warnings: live?.warnings ?? [],
    } satisfies AgentInspectionSnapshot;
  });
  return historical ?? live;
}
