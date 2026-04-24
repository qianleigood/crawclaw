import { isAgentActionEventData } from "../agents/action-feed/types.js";
import { resolveSharedContextArchiveService } from "../agents/context-archive/runtime.js";
import type {
  AgentInspectionSnapshot,
  AgentInspectionTimelineEntry,
} from "../agents/runtime/agent-inspection.js";
import {
  inspectAgentRuntime,
  mergeAgentInspectionArchive,
} from "../agents/runtime/agent-inspection.js";
import { loadConfig } from "../config/config.js";
import type { ObservationContext } from "../infra/observation/types.js";
import {
  readSessionSummaryFile,
  resolveDurableMemoryScope,
  resolveDreamClosedLoopStatus,
  resolveMemoryConfig,
  SqliteRuntimeStore,
} from "../memory/command-api.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";

export type AgentInspectOptions = {
  runId?: string;
  taskId?: string;
  traceId?: string;
  json?: boolean;
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatKeyValue(label: string, value: string | number | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return [`${label}: ${value}`];
}

function formatArray(label: string, values: string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return [label, ...values.map((value) => `  - ${value}`)];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isObservationContext(value: unknown): value is ObservationContext {
  if (!isObjectRecord(value) || !isObjectRecord(value.trace) || !isObjectRecord(value.runtime)) {
    return false;
  }
  return (
    typeof value.trace.traceId === "string" &&
    typeof value.trace.spanId === "string" &&
    (typeof value.trace.parentSpanId === "string" || value.trace.parentSpanId === null) &&
    typeof value.source === "string"
  );
}

function eventObservation(event: {
  payload?: unknown;
  metadata?: Record<string, unknown>;
}): ObservationContext | undefined {
  const payload = isObjectRecord(event.payload) ? event.payload : undefined;
  const metadata = isObjectRecord(event.metadata) ? event.metadata : undefined;
  if (isObservationContext(payload?.observation)) {
    return payload.observation;
  }
  if (isObservationContext(metadata?.observation)) {
    return metadata.observation;
  }
  return undefined;
}

function joinProjectedSummary(params: {
  projectedTitle?: string;
  projectedSummary?: string;
  title?: string;
}): string | undefined {
  const projectedTitle = normalizeOptionalString(params.projectedTitle);
  const projectedSummary = normalizeOptionalString(params.projectedSummary);
  const title = normalizeOptionalString(params.title);
  const base = projectedTitle ?? title;
  if (!base) {
    return undefined;
  }
  if (!projectedSummary || projectedSummary === base) {
    return base;
  }
  return `${base} · ${projectedSummary}`;
}

function formatTimelineSummary(entry: AgentInspectionTimelineEntry): string {
  const parts = [
    entry.phase ?? entry.type,
    entry.summary,
    ...(entry.decisionCode ? [`decision=${entry.decisionCode}`] : []),
    ...(entry.status ? [`status=${entry.status}`] : []),
  ];
  return parts.join(" | ");
}

function formatTimeline(snapshot: AgentInspectionSnapshot): string[] {
  if (!snapshot.timeline?.length) {
    return [];
  }
  const lines = ["Timeline:"];
  for (const entry of snapshot.timeline) {
    lines.push(`  - ${entry.createdAt} ${formatTimelineSummary(entry)}`);
    if (entry.spanId || entry.parentSpanId !== undefined) {
      lines.push(`    span=${entry.spanId ?? "(none)"} parent=${entry.parentSpanId ?? "(root)"}`);
    }
    if (entry.metrics && Object.keys(entry.metrics).length > 0) {
      lines.push(`    metrics=${JSON.stringify(entry.metrics)}`);
    }
    if (entry.refs && Object.keys(entry.refs).length > 0) {
      lines.push(`    refs=${JSON.stringify(entry.refs)}`);
    }
  }
  return lines;
}

function resolveLifecycleStatus(
  phase: string,
  payload: Record<string, unknown>,
): string | undefined {
  if (phase.endsWith("_error") || typeof payload.error === "string") {
    return "error";
  }
  if (phase === "stop_failure") {
    return "failed";
  }
  if (
    phase === "provider_request_stop" ||
    phase === "tool_call_stop" ||
    phase === "subagent_stop" ||
    phase === "stop"
  ) {
    return "ok";
  }
  return undefined;
}

function buildLifecycleSummary(
  phase: string,
  payload: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
): string {
  const decision = isObjectRecord(payload.decision) ? payload.decision : undefined;
  const refs = isObjectRecord(payload.refs) ? payload.refs : undefined;
  const decisionSummary =
    typeof decision?.summary === "string" && decision.summary.trim()
      ? decision.summary.trim()
      : undefined;
  const refToolName = typeof refs?.toolName === "string" ? refs.toolName : undefined;
  const refProvider =
    typeof refs?.provider === "string" && typeof refs?.modelId === "string"
      ? `${refs.provider}/${refs.modelId}`
      : undefined;
  const refSubagent =
    typeof decisionSummary === "string"
      ? decisionSummary
      : typeof refs?.childSessionKey === "string"
        ? refs.childSessionKey
        : undefined;
  const stopReason =
    typeof payload.stopReason === "string"
      ? payload.stopReason
      : typeof metadata?.stopReason === "string"
        ? metadata.stopReason
        : undefined;

  switch (phase) {
    case "provider_request_start":
    case "provider_request_stop":
    case "provider_request_error":
      return refProvider ?? decisionSummary ?? "provider request";
    case "tool_call_start":
    case "tool_call_stop":
    case "tool_call_error":
      return refToolName ?? decisionSummary ?? "tool call";
    case "subagent_start":
    case "subagent_stop":
      return refSubagent ?? "subagent";
    case "pre_compact":
    case "post_compact":
      return stopReason ?? decisionSummary ?? "compaction";
    case "stop":
    case "stop_failure":
      return stopReason ?? decisionSummary ?? "run stop";
    default:
      return decisionSummary ?? phase.replaceAll("_", " ");
  }
}

function buildInspectionTimeline(
  events: Array<{
    id: string;
    type: string;
    createdAt: number;
    payload?: unknown;
    metadata?: Record<string, unknown>;
  }>,
): AgentInspectionTimelineEntry[] {
  return events.flatMap<AgentInspectionTimelineEntry>((event) => {
    if (event.type === "agent.action" && isAgentActionEventData(event.payload)) {
      const action = event.payload;
      const summary =
        joinProjectedSummary({
          projectedTitle: action.projectedTitle,
          projectedSummary: action.projectedSummary,
          title: action.title,
        }) ?? action.kind;
      const refs: Record<string, string | number | boolean | null> = {
        actionId: action.actionId,
        kind: action.kind,
      };
      if (typeof action.parentActionId === "string") {
        refs.parentActionId = action.parentActionId;
      }
      if (typeof action.toolName === "string") {
        refs.toolName = action.toolName;
      }
      if (typeof action.toolCallId === "string") {
        refs.toolCallId = action.toolCallId;
      }
      return [
        {
          eventId: event.id,
          type: event.type,
          phase: `action.${action.kind}`,
          createdAt: event.createdAt,
          source: "action",
          status: action.status,
          summary,
          ...(Object.keys(refs).length > 0 ? { refs } : {}),
        },
      ];
    }
    if (!event.type.startsWith("run.lifecycle.")) {
      return [];
    }
    const payload = isObjectRecord(event.payload) ? event.payload : {};
    const metadata = isObjectRecord(event.metadata) ? event.metadata : undefined;
    const observation = eventObservation(event);
    const phase =
      typeof payload.phase === "string" ? payload.phase : event.type.slice("run.lifecycle.".length);
    const decision = isObjectRecord(payload.decision) ? payload.decision : undefined;
    const metrics = isObjectRecord(payload.metrics)
      ? (Object.fromEntries(
          Object.entries(payload.metrics).filter(([, value]) => typeof value === "number"),
        ) as Record<string, number>)
      : undefined;
    const refs = isObjectRecord(payload.refs)
      ? (Object.fromEntries(
          Object.entries(payload.refs).filter(
            ([, value]) =>
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean" ||
              value === null,
          ),
        ) as Record<string, string | number | boolean | null>)
      : undefined;
    const decisionCode =
      typeof decision?.code === "string"
        ? decision.code
        : typeof metadata?.decisionCode === "string"
          ? metadata.decisionCode
          : undefined;
    const decisionSummary =
      typeof decision?.summary === "string" && decision.summary.trim()
        ? decision.summary.trim()
        : undefined;
    return [
      {
        eventId: event.id,
        type: event.type,
        phase,
        createdAt: event.createdAt,
        source: "lifecycle",
        ...(observation ? { observation } : {}),
        ...(observation ? { traceId: observation.trace.traceId } : {}),
        ...(observation ? { spanId: observation.trace.spanId } : {}),
        ...(observation ? { parentSpanId: observation.trace.parentSpanId } : {}),
        ...(resolveLifecycleStatus(phase, payload)
          ? { status: resolveLifecycleStatus(phase, payload) }
          : {}),
        ...(decisionCode ? { decisionCode } : {}),
        ...(decisionSummary ? { decisionSummary } : {}),
        summary: buildLifecycleSummary(phase, payload, metadata),
        ...(metrics && Object.keys(metrics).length > 0 ? { metrics } : {}),
        ...(refs && Object.keys(refs).length > 0 ? { refs } : {}),
      },
    ];
  });
}

function formatArchive(snapshot: AgentInspectionSnapshot): string[] {
  if (!snapshot.archive?.runs.length) {
    return [];
  }
  const lines = ["Archive:"];
  for (const run of snapshot.archive.runs) {
    lines.push(`  Run: ${run.id}`);
    lines.push(
      ...formatKeyValue("    Kind", run.kind),
      ...formatKeyValue("    Status", run.status),
      ...formatKeyValue("    Mode", run.archiveMode),
      ...formatKeyValue("    Session", run.sessionId),
      ...formatKeyValue("    Conversation", run.conversationUid),
      ...formatKeyValue("    Task", run.taskId),
      ...formatKeyValue("    Agent", run.agentId),
      ...formatKeyValue("    Parent Agent", run.parentAgentId),
      ...formatKeyValue("    Turn", run.turnIndex),
      ...formatKeyValue("    Label", run.label),
      ...formatKeyValue("    Run ref", run.refs.runRef),
      ...formatKeyValue("    Events ref", run.refs.eventsRef),
    );
    if (run.refs.blobRefs.length > 0) {
      lines.push(...formatArray("    Blob refs:", run.refs.blobRefs));
    }
    if (run.metadata && Object.keys(run.metadata).length > 0) {
      lines.push(`    Metadata: ${JSON.stringify(run.metadata)}`);
    }
    if (run.summary !== undefined) {
      lines.push(`    Summary: ${JSON.stringify(run.summary)}`);
    }
  }
  return lines;
}

async function enrichInspectionWithArchive(
  snapshot: AgentInspectionSnapshot,
): Promise<AgentInspectionSnapshot> {
  if (!snapshot.runId && !snapshot.taskId && !snapshot.lookup.traceId) {
    return snapshot;
  }
  try {
    const archive = await resolveSharedContextArchiveService(loadConfig());
    if (!archive) {
      return snapshot;
    }
    let archived = await archive.inspect({
      ...(snapshot.runId ? { runId: snapshot.runId } : {}),
      ...(snapshot.taskId ? { taskId: snapshot.taskId } : {}),
      limit: 20,
    });
    const lookupTraceId = normalizeOptionalString(snapshot.lookup.traceId);
    if (lookupTraceId && !snapshot.runId && !snapshot.taskId) {
      const matchingRuns = [];
      for (const run of archived.runs) {
        const events = await archive.readEvents(run.id, {
          hydratePayload: true,
          limit: 50,
        });
        if (events.some((event) => eventObservation(event)?.trace.traceId === lookupTraceId)) {
          matchingRuns.push(run);
        }
      }
      archived = { runs: matchingRuns };
    }
    const merged = mergeAgentInspectionArchive(snapshot, archived);
    const latestTurnRun = archived.runs
      .filter((run) => run.kind === "turn")
      .toSorted((left, right) => right.updatedAt - left.updatedAt)[0];
    if (!latestTurnRun) {
      return merged;
    }
    const events = await archive.readEvents(latestTurnRun.id, {
      hydratePayload: true,
      limit: 50,
    });
    const timeline = buildInspectionTimeline(events);
    const latestModelVisibleContext = events
      .toReversed()
      .find((event) => event.type === "turn.model_visible_context");
    if (!latestModelVisibleContext || typeof latestModelVisibleContext.payload !== "object") {
      return {
        ...merged,
        ...(timeline.length > 0 ? { timeline } : {}),
      };
    }
    const payload = latestModelVisibleContext.payload as {
      queryContextDiagnostics?: {
        bootstrapFiles?: string[];
        skillNames?: string[];
        memorySources?: string[];
        queryContextHash?: string;
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
          selectedExperienceDetails?: Array<{
            itemId: string;
            title: string;
            source: string;
            memoryKind?: string;
            scoreBreakdown?: Record<string, number>;
          }>;
          omittedExperienceDetails?: Array<{
            itemId: string;
            title: string;
            source: string;
            memoryKind?: string;
            omittedReason?: string;
            scoreBreakdown?: Record<string, number>;
          }>;
          hitReason?: string;
          evictionReason?: string;
          durableRecallSource?: string;
          decisionCodes?: Record<string, string>;
        };
      };
      systemContextSections?: unknown[];
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
    const diagnostics = payload.queryContextDiagnostics;
    return {
      ...merged,
      ...(timeline.length > 0 ? { timeline } : {}),
      queryContext: {
        archiveRunId: latestTurnRun.id,
        eventId: latestModelVisibleContext.id,
        queryContextHash:
          diagnostics?.queryContextHash ?? payload.providerRequestSnapshot?.queryContextHash,
        bootstrapFiles: diagnostics?.bootstrapFiles,
        skillNames: diagnostics?.skillNames,
        memorySources: diagnostics?.memorySources,
        systemContextSectionCount: Array.isArray(payload.systemContextSections)
          ? payload.systemContextSections.length
          : undefined,
        sectionTokenUsage: diagnostics?.sectionTokenUsage,
        decisionCodes: diagnostics?.decisionCodes,
        hookMutations: diagnostics?.hookMutations,
        memoryRecall: diagnostics?.memoryRecall,
        providerRequestSnapshot: payload.providerRequestSnapshot,
      },
    };
  } catch {
    return snapshot;
  }
}

function parseMetricsJson(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function enrichInspectionWithDream(
  snapshot: AgentInspectionSnapshot,
): Promise<AgentInspectionSnapshot> {
  const sessionKey =
    normalizeOptionalString(snapshot.runtimeState?.sessionKey) ??
    normalizeOptionalString(snapshot.runContext?.sessionKey) ??
    normalizeOptionalString(snapshot.runtimeMetadata?.sessionKey);
  const agentId =
    normalizeOptionalString(snapshot.runtimeState?.agentId) ??
    normalizeOptionalString(snapshot.runContext?.agentId) ??
    normalizeOptionalString(snapshot.runtimeMetadata?.agentId);
  if (!sessionKey || !agentId) {
    return snapshot;
  }
  const scope = resolveDurableMemoryScope({ sessionKey, agentId });
  if (!scope?.scopeKey) {
    return snapshot;
  }
  const config = loadConfig();
  const rawMemory = config.memory;
  if (!rawMemory) {
    return snapshot;
  }
  const memoryConfig = resolveMemoryConfig(rawMemory);
  const store = new SqliteRuntimeStore(memoryConfig.runtimeStore.dbPath);
  await store.init();
  try {
    const state = await store.getDreamState(scope.scopeKey);
    const recentRuns = (await store.listRecentMaintenanceRuns(20))
      .filter((entry) => entry.kind === "dream" && entry.scope === scope.scopeKey)
      .slice(0, 5)
      .map((entry) => {
        const metrics = parseMetricsJson(entry.metricsJson);
        const touchedNotes = Array.isArray(metrics?.touchedNotes)
          ? metrics?.touchedNotes.filter((value): value is string => typeof value === "string")
          : [];
        return {
          id: entry.id,
          status: entry.status,
          summary: entry.summary,
          triggerSource: entry.triggerSource,
          reason: entry.error ?? null,
          ...(touchedNotes.length ? { touchedNotes } : {}),
        };
      });
    return {
      ...snapshot,
      dream: {
        scopeKey: scope.scopeKey,
        enabled: memoryConfig.dreaming.enabled,
        ...(memoryConfig.dreaming.transcriptFallback
          ? {
              transcriptFallback: {
                enabled: memoryConfig.dreaming.transcriptFallback.enabled,
                maxSessions: memoryConfig.dreaming.transcriptFallback.maxSessions,
                maxMatchesPerSession: memoryConfig.dreaming.transcriptFallback.maxMatchesPerSession,
                maxTotalBytes: memoryConfig.dreaming.transcriptFallback.maxTotalBytes,
                maxExcerptChars: memoryConfig.dreaming.transcriptFallback.maxExcerptChars,
              },
            }
          : {}),
        ...resolveDreamClosedLoopStatus({
          config: memoryConfig.dreaming,
          scopeKey: scope.scopeKey,
        }),
        ...(state
          ? {
              state: {
                lastSuccessAt: state.lastSuccessAt,
                lastAttemptAt: state.lastAttemptAt,
                lastFailureAt: state.lastFailureAt,
                lastSkipReason: state.lastSkipReason,
                lockOwner: state.lockOwner,
              },
            }
          : {}),
        recentRuns,
      },
    };
  } finally {
    await store.close();
  }
}

async function enrichInspectionWithSessionSummary(
  snapshot: AgentInspectionSnapshot,
): Promise<AgentInspectionSnapshot> {
  const sessionId =
    normalizeOptionalString(snapshot.runtimeState?.sessionId) ??
    normalizeOptionalString(snapshot.runContext?.sessionId) ??
    normalizeOptionalString(snapshot.runtimeMetadata?.sessionId);
  const agentId =
    normalizeOptionalString(snapshot.runtimeState?.agentId) ??
    normalizeOptionalString(snapshot.runContext?.agentId) ??
    normalizeOptionalString(snapshot.runtimeMetadata?.agentId);
  if (!sessionId || !agentId) {
    return snapshot;
  }
  const config = loadConfig();
  const memoryConfig = resolveMemoryConfig(config.memory ?? {});
  const store = new SqliteRuntimeStore(memoryConfig.runtimeStore.dbPath);
  await store.init();
  try {
    const [state, file] = await Promise.all([
      store.getSessionSummaryState(sessionId),
      readSessionSummaryFile({ agentId, sessionId }),
    ]);
    return {
      ...snapshot,
      sessionSummary: {
        sessionId,
        agentId,
        path: file.summaryPath,
        exists: file.exists,
        updatedAt: file.updatedAt,
        state: state
          ? {
              lastSummarizedMessageId: state.lastSummarizedMessageId,
              lastSummaryUpdatedAt: state.lastSummaryUpdatedAt,
              tokensAtLastSummary: state.tokensAtLastSummary,
              summaryInProgress: state.summaryInProgress,
            }
          : undefined,
      },
    };
  } finally {
    await store.close();
  }
}

export function formatAgentInspection(snapshot: AgentInspectionSnapshot): string {
  const lines = [
    "Agent Inspection:",
    ...formatKeyValue("  Run", snapshot.runId),
    ...formatKeyValue("  Task", snapshot.taskId),
    ...formatKeyValue("  Runtime", snapshot.runtimeState?.runtime ?? snapshot.task?.runtime),
    ...formatKeyValue("  Status", snapshot.runtimeState?.status ?? snapshot.task?.status),
    ...formatKeyValue("  Mode", snapshot.runtimeState?.mode ?? snapshot.task?.agentMetadata?.mode),
    ...formatKeyValue(
      "  Agent",
      snapshot.runtimeState?.agentId ??
        snapshot.runContext?.agentId ??
        snapshot.runtimeMetadata?.agentId ??
        snapshot.task?.agentId,
    ),
    ...formatKeyValue(
      "  Parent Agent",
      snapshot.runtimeState?.parentAgentId ??
        snapshot.runContext?.parentAgentId ??
        snapshot.runtimeMetadata?.parentAgentId ??
        snapshot.task?.agentMetadata?.parentAgentId,
    ),
    ...formatKeyValue(
      "  Session",
      snapshot.runtimeState?.sessionId ??
        snapshot.runContext?.sessionId ??
        snapshot.runtimeMetadata?.sessionId,
    ),
    ...formatKeyValue(
      "  Session Key",
      snapshot.runtimeState?.sessionKey ??
        snapshot.runContext?.sessionKey ??
        snapshot.runtimeMetadata?.sessionKey,
    ),
    ...formatKeyValue("  Label", snapshot.runtimeState?.label ?? snapshot.runContext?.label),
    ...formatKeyValue("  Goal", snapshot.runtimeState?.task ?? snapshot.runContext?.task),
    ...formatKeyValue("  Tool Calls", snapshot.runtimeState?.toolCallCount),
    ...formatKeyValue("  Last Tool", snapshot.runtimeState?.lastToolName),
    ...formatKeyValue("  Current Step", snapshot.runtimeState?.currentStep),
  ];

  if (snapshot.guard) {
    lines.push("Guard:");
    lines.push(
      `  Interactive approval: ${snapshot.guard.interactiveApprovalAvailable ? "available" : "blocked"}`,
    );
    if (snapshot.guard.interactiveApprovalBlocker) {
      lines.push(`  Blocker: ${snapshot.guard.interactiveApprovalBlocker}`);
    }
    if (snapshot.guard.sandboxed !== undefined) {
      lines.push(`  Sandboxed: ${snapshot.guard.sandboxed ? "yes" : "no"}`);
    }
    if (!snapshot.guard.controlUiVisible) {
      lines.push("  Hidden control UI: yes");
    }
    if (snapshot.guard.heartbeat) {
      lines.push("  Heartbeat run: yes");
    }
  }

  if (snapshot.completion) {
    lines.push("Completion:");
    lines.push(`  Status: ${snapshot.completion.status}`);
    lines.push(`  Summary: ${snapshot.completion.summary}`);
    if (snapshot.completion.blockingState) {
      lines.push(`  Blocker: ${snapshot.completion.blockingState}`);
    }
    if (snapshot.completion.warnings.length > 0) {
      lines.push(...formatArray("  Warnings:", snapshot.completion.warnings));
    }
  }

  if (snapshot.loop) {
    lines.push("Loop:");
    lines.push(`  Progress envelopes: ${snapshot.loop.progressCount}`);
    if (snapshot.loop.lastProgressTool) {
      lines.push(`  Last tool: ${snapshot.loop.lastProgressTool}`);
    }
    if (snapshot.loop.lastProgressStateDelta) {
      lines.push(`  Last state delta: ${snapshot.loop.lastProgressStateDelta}`);
    }
    if (snapshot.loop.warningBuckets.length > 0) {
      lines.push(
        ...formatArray(
          "  Warning buckets:",
          snapshot.loop.warningBuckets.map((entry) => `${entry.key} (${entry.count})`),
        ),
      );
    }
    if (snapshot.loop.commandPolls.length > 0) {
      lines.push(
        ...formatArray(
          "  Command polls:",
          snapshot.loop.commandPolls.map((entry) => `${entry.key} (${entry.count})`),
        ),
      );
    }
  }

  if (snapshot.dream) {
    lines.push("Dream:");
    lines.push(`  Scope: ${snapshot.dream.scopeKey}`);
    if (typeof snapshot.dream.enabled === "boolean") {
      lines.push(`  Enabled: ${snapshot.dream.enabled ? "yes" : "no"}`);
    }
    if (typeof snapshot.dream.closedLoopActive === "boolean") {
      lines.push(
        `  Closed loop: ${snapshot.dream.closedLoopActive ? "active" : "inactive"}${
          snapshot.dream.closedLoopReason ? ` (${snapshot.dream.closedLoopReason})` : ""
        }`,
      );
    }
    if (snapshot.dream.transcriptFallback) {
      const fallback = snapshot.dream.transcriptFallback;
      lines.push(
        `  Transcript fallback: ${fallback.enabled ? "enabled" : "disabled"}${
          fallback.maxSessions
            ? ` (maxSessions=${fallback.maxSessions}, maxMatchesPerSession=${fallback.maxMatchesPerSession ?? "?"})`
            : ""
        }`,
      );
    }
    if (snapshot.dream.state) {
      lines.push(`  Last success: ${snapshot.dream.state.lastSuccessAt ?? "(never)"}`);
      lines.push(`  Last attempt: ${snapshot.dream.state.lastAttemptAt ?? "(never)"}`);
      lines.push(`  Last failure: ${snapshot.dream.state.lastFailureAt ?? "(never)"}`);
      if (snapshot.dream.state.lastSkipReason) {
        lines.push(`  Last skip reason: ${snapshot.dream.state.lastSkipReason}`);
      }
      if (snapshot.dream.state.lockOwner) {
        lines.push(`  Lock owner: ${snapshot.dream.state.lockOwner}`);
      }
    }
    if (snapshot.dream.recentRuns.length > 0) {
      lines.push("  Recent runs:");
      for (const run of snapshot.dream.recentRuns) {
        lines.push(
          `    - ${run.status} ${run.triggerSource ?? "(no-trigger)"} ${run.summary ?? ""}`.trim(),
        );
        if (run.reason) {
          lines.push(`      reason: ${run.reason}`);
        }
        if (run.touchedNotes?.length) {
          for (const note of run.touchedNotes) {
            lines.push(`      touched: ${note}`);
          }
        }
      }
    }
  }

  if (snapshot.sessionSummary) {
    lines.push("Session Summary:");
    lines.push(`  Session: ${snapshot.sessionSummary.sessionId}`);
    lines.push(`  Agent: ${snapshot.sessionSummary.agentId}`);
    lines.push(`  Path: ${snapshot.sessionSummary.path}`);
    lines.push(`  Exists: ${snapshot.sessionSummary.exists ? "yes" : "no"}`);
    if (snapshot.sessionSummary.updatedAt != null) {
      lines.push(`  Updated: ${snapshot.sessionSummary.updatedAt}`);
    }
    if (snapshot.sessionSummary.state) {
      lines.push(
        `  Last summarized message: ${snapshot.sessionSummary.state.lastSummarizedMessageId ?? "(none)"}`,
      );
      lines.push(
        `  Last summary update: ${snapshot.sessionSummary.state.lastSummaryUpdatedAt ?? "(never)"}`,
      );
      lines.push(`  Tokens at last summary: ${snapshot.sessionSummary.state.tokensAtLastSummary}`);
      lines.push(
        `  In progress: ${snapshot.sessionSummary.state.summaryInProgress ? "yes" : "no"}`,
      );
    }
  }

  if (snapshot.queryContext) {
    lines.push("Query Context:");
    lines.push(`  Archive run: ${snapshot.queryContext.archiveRunId}`);
    lines.push(`  Event: ${snapshot.queryContext.eventId}`);
    if (snapshot.queryContext.queryContextHash) {
      lines.push(`  Hash: ${snapshot.queryContext.queryContextHash}`);
    }
    if (snapshot.queryContext.systemContextSectionCount != null) {
      lines.push(`  System context sections: ${snapshot.queryContext.systemContextSectionCount}`);
    }
    if (snapshot.queryContext.bootstrapFiles?.length) {
      lines.push(...formatArray("  Bootstrap files:", snapshot.queryContext.bootstrapFiles));
    }
    if (snapshot.queryContext.skillNames?.length) {
      lines.push(...formatArray("  Skills:", snapshot.queryContext.skillNames));
    }
    if (snapshot.queryContext.memorySources?.length) {
      lines.push(...formatArray("  Memory sources:", snapshot.queryContext.memorySources));
    }
    if (snapshot.queryContext.sectionTokenUsage) {
      lines.push(
        `  Section tokens total: ${snapshot.queryContext.sectionTokenUsage.totalEstimatedTokens ?? 0}`,
      );
      if (snapshot.queryContext.sectionTokenUsage.byRole) {
        lines.push(
          `  Section tokens by role: ${JSON.stringify(snapshot.queryContext.sectionTokenUsage.byRole)}`,
        );
      }
      if (snapshot.queryContext.sectionTokenUsage.byType) {
        lines.push(
          `  Section tokens by type: ${JSON.stringify(snapshot.queryContext.sectionTokenUsage.byType)}`,
        );
      }
    }
    if (snapshot.queryContext.decisionCodes) {
      lines.push(`  Decision codes: ${JSON.stringify(snapshot.queryContext.decisionCodes)}`);
    }
    if (snapshot.queryContext.hookMutations?.length) {
      lines.push(
        ...formatArray(
          "  Hook mutations:",
          snapshot.queryContext.hookMutations.map(
            (item) =>
              `${item.hook}: user(+${item.prependUserContextSections}/+${item.appendUserContextSections}) ` +
              `system(+${item.prependSystemContextSections}/+${item.appendSystemContextSections}) ` +
              `replaceSystemPrompt=${item.replaceSystemPromptSections} ` +
              `clearSystemContext=${item.clearSystemContextSections} replaceUserPrompt=${item.replaceUserPrompt}`,
          ),
        ),
      );
    }
    if (snapshot.queryContext.memoryRecall) {
      lines.push(
        `  Memory recall: hit=${snapshot.queryContext.memoryRecall.hitReason ?? "(none)"} eviction=${snapshot.queryContext.memoryRecall.evictionReason ?? "(none)"}`,
      );
      if (snapshot.queryContext.memoryRecall.durableRecallSource) {
        lines.push(
          `  Durable recall source: ${snapshot.queryContext.memoryRecall.durableRecallSource}`,
        );
      }
      if (snapshot.queryContext.memoryRecall.decisionCodes) {
        lines.push(
          `  Memory recall decision codes: ${JSON.stringify(snapshot.queryContext.memoryRecall.decisionCodes)}`,
        );
      }
      if (snapshot.queryContext.memoryRecall.selectedItemIds?.length) {
        lines.push(
          ...formatArray(
            "  Memory selected IDs:",
            snapshot.queryContext.memoryRecall.selectedItemIds,
          ),
        );
      }
      if (snapshot.queryContext.memoryRecall.omittedItemIds?.length) {
        lines.push(
          ...formatArray(
            "  Memory omitted IDs:",
            snapshot.queryContext.memoryRecall.omittedItemIds,
          ),
        );
      }
      if (snapshot.queryContext.memoryRecall.selectedDurableDetails?.length) {
        lines.push(
          ...formatArray(
            "  Durable selected details:",
            snapshot.queryContext.memoryRecall.selectedDurableDetails.map(
              (entry) => `${entry.itemId} [${entry.provenance.join(", ")}]`,
            ),
          ),
        );
      }
      if (snapshot.queryContext.memoryRecall.omittedDurableDetails?.length) {
        lines.push(
          ...formatArray(
            "  Durable omitted details:",
            snapshot.queryContext.memoryRecall.omittedDurableDetails.map(
              (entry) =>
                `${entry.itemId} [${entry.provenance.join(", ")}] reason=${entry.omittedReason ?? "unknown"}`,
            ),
          ),
        );
      }
      if (snapshot.queryContext.memoryRecall.selectedExperienceDetails?.length) {
        lines.push(
          ...formatArray(
            "  Experience selected details:",
            snapshot.queryContext.memoryRecall.selectedExperienceDetails.map(
              (entry) =>
                `${entry.itemId} source=${entry.source} kind=${entry.memoryKind ?? "unknown"}`,
            ),
          ),
        );
      }
      if (snapshot.queryContext.memoryRecall.omittedExperienceDetails?.length) {
        lines.push(
          ...formatArray(
            "  Experience omitted details:",
            snapshot.queryContext.memoryRecall.omittedExperienceDetails.map(
              (entry) =>
                `${entry.itemId} source=${entry.source} kind=${entry.memoryKind ?? "unknown"} reason=${entry.omittedReason ?? "unknown"}`,
            ),
          ),
        );
      }
      if (snapshot.queryContext.memoryRecall.recentDreamTouchedNotes?.length) {
        lines.push(
          ...formatArray(
            "  Dream touched durable notes:",
            snapshot.queryContext.memoryRecall.recentDreamTouchedNotes,
          ),
        );
      }
    }
    if (snapshot.queryContext.providerRequestSnapshot) {
      lines.push(
        `  Provider request chars: prompt=${snapshot.queryContext.providerRequestSnapshot.promptChars} system=${snapshot.queryContext.providerRequestSnapshot.systemPromptChars}`,
      );
      lines.push(
        `  Provider request sections: ${snapshot.queryContext.providerRequestSnapshot.sectionOrder.length}`,
      );
      if (snapshot.queryContext.providerRequestSnapshot.decisionCodes) {
        lines.push(
          `  Provider request decision codes: ${JSON.stringify(snapshot.queryContext.providerRequestSnapshot.decisionCodes)}`,
        );
      }
    }
  }

  lines.push(...formatTimeline(snapshot));
  lines.push(...formatArchive(snapshot));

  const refs = [
    snapshot.refs.runtimeStateRef,
    snapshot.refs.transcriptRef,
    snapshot.refs.trajectoryRef,
    snapshot.refs.capabilitySnapshotRef,
  ].filter((value): value is string => Boolean(value));
  if (refs.length > 0) {
    lines.push(...formatArray("Refs:", refs));
  }
  if (snapshot.warnings.length > 0) {
    lines.push(...formatArray("Warnings:", snapshot.warnings));
  }
  return lines.join("\n");
}

export function resolveAgentInspectionOrExit(
  opts: AgentInspectOptions,
  runtime: RuntimeEnv,
): AgentInspectionSnapshot | undefined {
  const runId = normalizeOptionalString(opts.runId);
  const taskId = normalizeOptionalString(opts.taskId);
  const traceId = normalizeOptionalString(opts.traceId);
  if (!runId && !taskId && !traceId) {
    runtime.error("Pass --run-id, --task-id, or --trace-id.");
    runtime.exit(1);
    return undefined;
  }

  const inspection = inspectAgentRuntime({
    ...(runId ? { runId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {}),
  });
  if (!inspection && traceId && !runId && !taskId) {
    return {
      lookup: { traceId },
      refs: {},
      warnings: ["Runtime state not found"],
    };
  }
  if (!inspection) {
    runtime.error(
      `Agent inspection target not found${runId ? ` for run ${runId}` : ""}${taskId ? ` for task ${taskId}` : ""}${traceId ? ` for trace ${traceId}` : ""}.`,
    );
    runtime.exit(1);
    return undefined;
  }
  return inspection;
}

export async function agentInspectCommand(
  opts: AgentInspectOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<AgentInspectionSnapshot | undefined> {
  const inspection = resolveAgentInspectionOrExit(opts, runtime);
  if (!inspection) {
    return undefined;
  }
  const enrichedInspection = await enrichInspectionWithArchive(inspection);
  const dreamEnrichedInspection = await enrichInspectionWithDream(enrichedInspection);
  const fullyEnrichedInspection = await enrichInspectionWithSessionSummary(dreamEnrichedInspection);
  if (opts.json) {
    writeRuntimeJson(runtime, fullyEnrichedInspection);
  } else {
    runtime.log(formatAgentInspection(fullyEnrichedInspection));
  }
  return fullyEnrichedInspection;
}
