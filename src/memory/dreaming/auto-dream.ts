import type { SpecialAgentParentForkContext } from "../../agents/special/runtime/parent-fork-context.js";
import type { ObservationContext } from "../../infra/observation/types.js";
import { buildRandomTempFilePath } from "../../plugin-sdk/temp-path.js";
import { isSubagentSessionKey } from "../../sessions/session-key-utils.ts";
import { DEFAULT_CONFIG } from "../config/defaults.ts";
import { resolveDurableMemoryScope, type DurableMemoryScope } from "../durable/scope.ts";
import { scanDurableMemoryScopeEntries } from "../durable/store.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { readSessionSummaryFile } from "../session-summary/store.ts";
import type { DreamingConfig } from "../types/config.ts";
import { newId } from "../util/ids.ts";
import type {
  DreamRunParams,
  DreamRunResult,
  DreamSignal,
  DreamSessionSummary,
  DreamTranscriptFallbackPlan,
} from "./agent-runner.ts";

type RuntimeLogger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

export type AutoDreamRunner = (
  params: DreamRunParams,
  logger?: RuntimeLogger,
) => Promise<DreamRunResult>;

type SubmitAutoDreamTurnParams = {
  sessionId: string;
  sessionKey?: string;
  sessionFile?: string;
  workspaceDir?: string;
  runtimeContext?: {
    agentId?: string | null;
    messageChannel?: string | null;
    senderId?: string | null;
    parentRunId?: string | null;
    parentForkContext?: SpecialAgentParentForkContext | null;
    observation?: ObservationContext;
  };
};

type RunAutoDreamNowParams = {
  scope: DurableMemoryScope;
  sessionId?: string;
  sessionFile?: string;
  workspaceDir?: string;
  sessionKey?: string;
  parentRunId?: string;
  parentForkContext?: SpecialAgentParentForkContext;
  triggerSource: string;
  bypassGate?: boolean;
  dryRun?: boolean;
  sessionLimit?: number;
  signalLimit?: number;
};

type AutoDreamPreview = {
  scopeKey: string;
  recentSessionIds: string[];
  recentSessionCount: number;
  recentSignalCount: number;
  recentSignals: DreamSignal[];
  sessionSummaries: DreamSessionSummary[];
  transcriptFallback: DreamTranscriptFallbackPlan;
};

type AutoDreamSchedulerParams = {
  config: DreamingConfig;
  runtimeStore: RuntimeStore;
  runner?: AutoDreamRunner;
  logger: RuntimeLogger;
};

function clampInt(value: number | undefined, fallback: number, minimum = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(value));
}

function resolveTranscriptFallbackConfig(config: DreamingConfig) {
  return config.transcriptFallback ?? DEFAULT_CONFIG.dreaming.transcriptFallback!;
}

function buildTranscriptFallbackPlan(params: {
  config: DreamingConfig;
  now: number;
  sessionIds: string[];
  summaries: DreamSessionSummary[];
  signals: DreamSignal[];
}): DreamTranscriptFallbackPlan {
  const config = resolveTranscriptFallbackConfig(params.config);
  const limits = {
    maxSessions: clampInt(config.maxSessions, 4),
    maxMatchesPerSession: clampInt(config.maxMatchesPerSession, 2),
    maxTotalBytes: clampInt(config.maxTotalBytes, 12_000, 512),
    maxExcerptChars: clampInt(config.maxExcerptChars, 900, 80),
  };
  if (!config.enabled) {
    return { enabled: false, reasons: [], sessionIds: [], limits };
  }
  const summaryBySession = new Map(params.summaries.map((summary) => [summary.sessionId, summary]));
  const reasons = new Set<string>();
  if (params.sessionIds.some((sessionId) => !summaryBySession.has(sessionId))) {
    reasons.add("missing_session_summary");
  }
  const staleSummaryMs = Math.max(0, config.staleSummaryMs);
  if (
    staleSummaryMs > 0 &&
    params.summaries.some(
      (summary) => summary.updatedAt <= 0 || params.now - summary.updatedAt > staleSummaryMs,
    )
  ) {
    reasons.add("stale_session_summary");
  }
  if (params.signals.length < Math.max(0, config.minSignals)) {
    reasons.add("weak_structured_signals");
  }
  if (reasons.size === 0) {
    return { enabled: false, reasons: [], sessionIds: [], limits };
  }
  return {
    enabled: true,
    reasons: Array.from(reasons),
    sessionIds: params.sessionIds.slice(0, limits.maxSessions),
    limits,
  };
}

async function collectRecentSessionSummaries(params: {
  runtimeStore: RuntimeStore;
  scope: DurableMemoryScope;
  sessionIds: string[];
}): Promise<DreamSessionSummary[]> {
  const rows = await Promise.all(
    params.sessionIds.map(async (sessionId) => ({
      sessionId,
      state: await params.runtimeStore.getSessionSummaryState(sessionId),
      file: await readSessionSummaryFile({
        agentId: params.scope.agentId,
        sessionId,
      }),
    })),
  );
  return rows
    .flatMap(({ sessionId, state, file }) => {
      if (!file.content?.trim()) {
        return [];
      }
      return [
        {
          sessionId,
          summaryText: file.content,
          lastSummarizedTurn: 0,
          updatedAt: state?.lastSummaryUpdatedAt ?? file.updatedAt ?? 0,
        } satisfies DreamSessionSummary,
      ];
    })
    .toSorted((left, right) => right.updatedAt - left.updatedAt);
}

function safeParseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
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

async function collectRecentStructuredSignals(params: {
  runtimeStore: RuntimeStore;
  scope: DurableMemoryScope;
  scopeKey: string;
  sessionIds: string[];
  limitPerSession?: number;
  maxSignals?: number;
}): Promise<DreamSignal[]> {
  const signals: DreamSignal[] = [];
  const perSession = Math.max(1, params.limitPerSession ?? 2);
  for (const sessionId of params.sessionIds.slice(0, 8)) {
    const runs = await params.runtimeStore.listRecentContextArchiveRuns(6, sessionId);
    const actionSummaries: string[] = [];
    for (const run of runs.slice(0, 3)) {
      const events = await params.runtimeStore.listContextArchiveEvents(run.id, 24);
      for (const event of events) {
        if (event.eventKind !== "agent.action") {
          continue;
        }
        const payload = safeParseJsonObject(event.payloadJson);
        const action = payload?.action;
        if (!action || typeof action !== "object") {
          continue;
        }
        const title: string | null =
          typeof (action as Record<string, unknown>).title === "string"
            ? ((action as Record<string, unknown>).title as string)
            : null;
        const summary: string | null =
          typeof (action as Record<string, unknown>).summary === "string"
            ? ((action as Record<string, unknown>).summary as string)
            : null;
        if (!title) {
          continue;
        }
        actionSummaries.push(summary ? `${title} (${summary})` : title);
        if (actionSummaries.length >= perSession) {
          break;
        }
      }
      if (actionSummaries.length >= perSession) {
        break;
      }
    }
    if (actionSummaries.length > 0) {
      signals.push({
        sessionId,
        kind: "archive_actions",
        text: actionSummaries.join("; "),
      });
    }
  }

  const maintenanceRuns = (await params.runtimeStore.listRecentMaintenanceRuns(40))
    .filter((entry) => entry.scope === params.scopeKey)
    .filter((entry) => entry.kind === "dream" || entry.kind === "durable_extraction")
    .slice(0, 4);
  for (const run of maintenanceRuns) {
    const parts = [run.kind, run.status];
    if (run.summary) {
      parts.push(run.summary);
    }
    signals.push({
      sessionId: run.id,
      kind: "maintenance_runs",
      text: parts.join(" | "),
    });
  }

  const recentDurableEntries = (await scanDurableMemoryScopeEntries(params.scope))
    .filter((entry) => entry.updatedAt > 0)
    .slice(0, 4);
  for (const entry of recentDurableEntries) {
    signals.push({
      sessionId: entry.notePath,
      kind: "recent_durable_changes",
      text: `recent durable note: [${entry.durableType}] ${entry.notePath} | ${entry.description || entry.title}`,
    });
  }

  return signals.slice(0, Math.max(1, params.maxSignals ?? 12));
}

async function collectDreamInputs(params: {
  runtimeStore: RuntimeStore;
  config: DreamingConfig;
  scope: DurableMemoryScope;
  scopeKey: string;
  sessionIds: string[];
  sessionLimit?: number;
  signalLimit?: number;
  now?: number;
}): Promise<AutoDreamPreview> {
  const sessionIds = params.sessionIds.slice(0, Math.max(1, params.sessionLimit ?? 12));
  const summaries = await collectRecentSessionSummaries({
    runtimeStore: params.runtimeStore,
    scope: params.scope,
    sessionIds,
  });
  const recentSignals = await collectRecentStructuredSignals({
    runtimeStore: params.runtimeStore,
    scope: params.scope,
    scopeKey: params.scopeKey,
    sessionIds,
    maxSignals: params.signalLimit,
  });
  const transcriptFallback = buildTranscriptFallbackPlan({
    config: params.config,
    now: params.now ?? Date.now(),
    sessionIds,
    summaries,
    signals: recentSignals,
  });
  return {
    scopeKey: params.scopeKey,
    recentSessionIds: sessionIds,
    recentSessionCount: summaries.length,
    recentSignalCount: recentSignals.length,
    recentSignals,
    sessionSummaries: summaries,
    transcriptFallback,
  };
}

export class AutoDreamScheduler {
  private config: DreamingConfig;
  private runtimeStore: RuntimeStore;
  private runner?: AutoDreamRunner;
  private logger: RuntimeLogger;
  private readonly inFlightScopes = new Set<string>();

  constructor(params: AutoDreamSchedulerParams) {
    this.config = params.config;
    this.runtimeStore = params.runtimeStore;
    this.runner = params.runner;
    this.logger = params.logger;
  }

  reconfigure(params: AutoDreamSchedulerParams): void {
    this.config = params.config;
    this.runtimeStore = params.runtimeStore;
    this.runner = params.runner;
    this.logger = params.logger;
  }

  submitTurn(params: SubmitAutoDreamTurnParams): void {
    if (!this.config.enabled || !this.runner || !params.sessionKey?.trim()) {
      return;
    }
    const sessionKey = params.sessionKey.trim();
    if (isSubagentSessionKey(sessionKey)) {
      return;
    }
    const scope = resolveDurableMemoryScope({
      sessionKey,
      agentId: params.runtimeContext?.agentId,
      channel: params.runtimeContext?.messageChannel,
      userId: params.runtimeContext?.senderId,
    });
    if (!scope?.scopeKey) {
      return;
    }
    if (this.inFlightScopes.has(scope.scopeKey)) {
      return;
    }
    const parentForkContext = params.runtimeContext?.parentForkContext ?? undefined;
    const parentRunId =
      parentForkContext?.parentRunId?.trim() || params.runtimeContext?.parentRunId?.trim();
    this.inFlightScopes.add(scope.scopeKey);
    void this.runNow({
      scope,
      sessionId: params.sessionId,
      ...(params.sessionFile?.trim() ? { sessionFile: params.sessionFile.trim() } : {}),
      ...(params.workspaceDir?.trim() ? { workspaceDir: params.workspaceDir.trim() } : {}),
      sessionKey,
      ...(parentForkContext ? { parentForkContext } : {}),
      ...(!parentForkContext && parentRunId ? { parentRunId } : {}),
      triggerSource: "stop",
    }).finally(() => {
      this.inFlightScopes.delete(scope.scopeKey ?? "");
    });
  }

  async runNow(params: RunAutoDreamNowParams): Promise<{
    status: "started" | "skipped" | "failed" | "preview";
    reason?: string;
    runId?: string;
    preview?: AutoDreamPreview;
  }> {
    if (!this.runner || !params.scope.scopeKey) {
      return { status: "skipped", reason: "dreaming disabled" };
    }
    const scopeKey = params.scope.scopeKey;
    const now = Date.now();
    const state = await this.runtimeStore.getDreamState(scopeKey);
    if (!params.bypassGate) {
      const minIntervalMs = Math.max(0, this.config.minHours) * 3_600_000;
      if (state?.lastSuccessAt != null && now - state.lastSuccessAt < minIntervalMs) {
        await this.runtimeStore.touchDreamAttempt({ scopeKey, now, reason: "min_hours_gate" });
        return { status: "skipped", reason: "min_hours_gate" };
      }
      if (state?.lastAttemptAt != null && now - state.lastAttemptAt < this.config.scanThrottleMs) {
        await this.runtimeStore.touchDreamAttempt({ scopeKey, now, reason: "scan_throttle" });
        return { status: "skipped", reason: "scan_throttle" };
      }
    }

    const recentSessionIds = await this.runtimeStore.listScopedSessionIdsTouchedSince(
      scopeKey,
      state?.lastSuccessAt ?? 0,
      null,
      clampInt(this.config.minSessions * 4, 20),
    );
    if (!params.bypassGate && recentSessionIds.length < this.config.minSessions) {
      await this.runtimeStore.touchDreamAttempt({ scopeKey, now, reason: "min_sessions_gate" });
      return { status: "skipped", reason: "min_sessions_gate" };
    }

    const preview = await collectDreamInputs({
      runtimeStore: this.runtimeStore,
      config: this.config,
      scope: params.scope,
      scopeKey,
      sessionIds: recentSessionIds,
      sessionLimit: params.sessionLimit,
      signalLimit: params.signalLimit,
      now,
    });

    if (params.dryRun) {
      return {
        status: "preview",
        reason: "dry_run_preview",
        preview,
      };
    }

    const lockOwner = newId("dream");
    const lock = await this.runtimeStore.acquireDreamLock({
      scopeKey,
      owner: lockOwner,
      staleAfterMs: this.config.lockStaleAfterMs,
      now,
    });
    if (!lock.acquired) {
      return { status: "skipped", reason: "lock_held" };
    }

    const runId = await this.runtimeStore.createMaintenanceRun({
      kind: "dream",
      status: "running",
      scope: scopeKey,
      triggerSource: params.triggerSource,
      summary: "Dream running",
    });

    const embeddedSessionId =
      params.sessionId?.trim() || preview.recentSessionIds[0]?.trim() || `dream-${scopeKey}`;
    const embeddedWorkspaceDir = params.workspaceDir?.trim() || process.cwd();
    const embeddedSessionFile =
      params.sessionFile?.trim() ||
      buildRandomTempFilePath({
        prefix: embeddedSessionId,
        extension: ".jsonl",
      });

    try {
      const result = await this.runner(
        {
          runId,
          sessionId: embeddedSessionId,
          sessionFile: embeddedSessionFile,
          workspaceDir: embeddedWorkspaceDir,
          ...(params.parentForkContext ? { parentForkContext: params.parentForkContext } : {}),
          ...(!params.parentForkContext && params.parentRunId
            ? { parentRunId: params.parentRunId }
            : {}),
          scope: params.scope,
          sessionKey: params.sessionKey,
          triggerSource: params.triggerSource,
          lastSuccessAt: state?.lastSuccessAt ?? null,
          recentSessions: preview.sessionSummaries,
          recentSignals: preview.recentSignals,
          transcriptFallback: preview.transcriptFallback,
        },
        this.logger,
      );

      await this.runtimeStore.updateMaintenanceRun({
        id: runId,
        status: result.status === "failed" ? "failed" : "done",
        summary: result.summary ?? "Dream completed",
        metricsJson: JSON.stringify({
          recentSessionCount: preview.recentSessionCount,
          recentSignalCount: preview.recentSignalCount,
          writtenCount: result.writtenCount,
          updatedCount: result.updatedCount,
          deletedCount: result.deletedCount,
          touchedNotes: result.touchedNotes ?? [],
          transcriptFallback: {
            enabled: preview.transcriptFallback.enabled,
            reasons: preview.transcriptFallback.reasons,
            sessionCount: preview.transcriptFallback.sessionIds.length,
            limits: preview.transcriptFallback.limits,
          },
        }),
        ...(result.status === "failed" ? { error: result.summary ?? "dream failed" } : {}),
        finishedAt: Date.now(),
      });
      await this.runtimeStore.releaseDreamLock({
        scopeKey,
        owner: lockOwner,
        runId,
        status: result.status === "failed" ? "failed" : "succeeded",
      });
      return {
        status: result.status === "failed" ? "failed" : "started",
        reason: result.summary,
        runId,
      };
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      await this.runtimeStore.updateMaintenanceRun({
        id: runId,
        status: "failed",
        summary: "Dream failed",
        error: summary,
        finishedAt: Date.now(),
      });
      await this.runtimeStore.releaseDreamLock({
        scopeKey,
        owner: lockOwner,
        runId,
        status: "failed",
      });
      this.logger.warn(`[memory] dream failed scope=${scopeKey} error=${summary}`);
      return { status: "failed", reason: summary, runId };
    }
  }
}

let sharedAutoDreamScheduler: AutoDreamScheduler | null = null;

export function getSharedAutoDreamScheduler(params: AutoDreamSchedulerParams): AutoDreamScheduler {
  if (!sharedAutoDreamScheduler) {
    sharedAutoDreamScheduler = new AutoDreamScheduler(params);
    return sharedAutoDreamScheduler;
  }
  sharedAutoDreamScheduler.reconfigure(params);
  return sharedAutoDreamScheduler;
}

export const __testing = {
  resetSharedAutoDreamScheduler() {
    sharedAutoDreamScheduler = null;
  },
};
