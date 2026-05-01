import type { SpecialAgentParentForkContext } from "../../agents/special/runtime/parent-fork-context.js";
import type { ObservationContext } from "../../infra/observation/types.js";
import { buildRandomTempFilePath } from "../../plugin-sdk/temp-path.js";
import { isMemoryAutomationExcludedSessionKey } from "../../sessions/session-key-utils.ts";
import { resolveDurableMemoryScope, type DurableMemoryScope } from "../durable/scope.ts";
import { scanDurableMemoryScopeEntries } from "../durable/store.ts";
import { resolveMemoryMessageChannel } from "../engine/context-memory-runtime-helpers.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { renderSessionSummaryForCompaction } from "../session-summary/sections.ts";
import { readSessionSummaryFile } from "../session-summary/store.ts";
import type { DreamingConfig } from "../types/config.ts";
import { newId } from "../util/ids.ts";
import type {
  DreamRunParams,
  DreamRunResult,
  DreamSignal,
  DreamSessionSummary,
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
    messageProvider?: string | null;
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
};

type AutoDreamBeforeRunParams = {
  scope: DurableMemoryScope;
  sessionId?: string;
  sessionKey?: string;
  triggerSource: string;
};

type AutoDreamBeforeRun = (params: AutoDreamBeforeRunParams) => Promise<void> | void;

type AutoDreamSchedulerParams = {
  config: DreamingConfig;
  runtimeStore: RuntimeStore;
  runner?: AutoDreamRunner;
  logger: RuntimeLogger;
  beforeRun?: AutoDreamBeforeRun;
};

const DREAM_SESSION_SUMMARY_TOKEN_BUDGET = 1_200;

function clampInt(value: number | undefined, fallback: number, minimum = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(value));
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
      compactionState:
        typeof params.runtimeStore.getSessionCompactionState === "function"
          ? await params.runtimeStore.getSessionCompactionState(sessionId)
          : null,
      file: await readSessionSummaryFile({
        agentId: params.scope.agentId,
        sessionId,
      }),
    })),
  );
  return rows
    .flatMap(({ sessionId, state, compactionState, file }) => {
      if (file.content?.trim()) {
        const summary: DreamSessionSummary = {
          sessionId,
          source: "session_summary",
          summaryText:
            renderSessionSummaryForCompaction(file.content, {
              tokenBudget: DREAM_SESSION_SUMMARY_TOKEN_BUDGET,
            }) || file.content.trim(),
          updatedAt: state?.lastSummaryUpdatedAt ?? file.updatedAt ?? 0,
        };
        return [summary];
      }
      const compactSummary = compactionState?.summaryOverrideText?.trim();
      if (!compactSummary) {
        return [];
      }
      const summary: DreamSessionSummary = {
        sessionId,
        source: "compact_summary",
        summaryText:
          renderSessionSummaryForCompaction(compactSummary, {
            tokenBudget: DREAM_SESSION_SUMMARY_TOKEN_BUDGET,
          }) || compactSummary,
        updatedAt: compactionState?.updatedAt ?? state?.lastSummaryUpdatedAt ?? file.updatedAt ?? 0,
      };
      return [summary];
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
  scope: DurableMemoryScope;
  scopeKey: string;
  sessionIds: string[];
  sessionLimit?: number;
  signalLimit?: number;
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
  return {
    scopeKey: params.scopeKey,
    recentSessionIds: sessionIds,
    recentSessionCount: summaries.length,
    recentSignalCount: recentSignals.length,
    recentSignals,
    sessionSummaries: summaries,
  };
}

export class AutoDreamScheduler {
  private config: DreamingConfig;
  private runtimeStore: RuntimeStore;
  private runner?: AutoDreamRunner;
  private logger: RuntimeLogger;
  private beforeRun?: AutoDreamBeforeRun;
  private readonly inFlightScopes = new Set<string>();

  constructor(params: AutoDreamSchedulerParams) {
    this.config = params.config;
    this.runtimeStore = params.runtimeStore;
    this.runner = params.runner;
    this.logger = params.logger;
    this.beforeRun = params.beforeRun;
  }

  reconfigure(params: AutoDreamSchedulerParams): void {
    this.config = params.config;
    this.runtimeStore = params.runtimeStore;
    this.runner = params.runner;
    this.logger = params.logger;
    this.beforeRun = params.beforeRun;
  }

  private async waitBeforeRun(params: AutoDreamBeforeRunParams): Promise<void> {
    if (!this.beforeRun) {
      return;
    }
    try {
      await this.beforeRun(params);
    } catch (error) {
      this.logger.warn(
        `[memory] dream pre-run maintenance wait failed scope=${params.scope.scopeKey ?? "unknown"} error=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  submitTurn(params: SubmitAutoDreamTurnParams): void {
    if (!this.config.enabled || !this.runner || !params.sessionKey?.trim()) {
      return;
    }
    const sessionKey = params.sessionKey.trim();
    if (isMemoryAutomationExcludedSessionKey(sessionKey)) {
      return;
    }
    const scope = resolveDurableMemoryScope({
      sessionKey,
      agentId: params.runtimeContext?.agentId,
      channel: resolveMemoryMessageChannel(params.runtimeContext),
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
    const runner = this.runner;
    const runtimeStore = this.runtimeStore;
    const config = this.config;
    const logger = this.logger;

    if (!runner || !params.scope.scopeKey) {
      return { status: "skipped", reason: "dreaming disabled" };
    }
    const scopeKey = params.scope.scopeKey;
    const now = Date.now();
    const state = await runtimeStore.getDreamState(scopeKey);
    if (!params.bypassGate) {
      const minIntervalMs = Math.max(0, config.minHours) * 3_600_000;
      if (state?.lastSuccessAt != null && now - state.lastSuccessAt < minIntervalMs) {
        await runtimeStore.touchDreamAttempt({ scopeKey, now, reason: "min_hours_gate" });
        return { status: "skipped", reason: "min_hours_gate" };
      }
      if (state?.lastAttemptAt != null && now - state.lastAttemptAt < config.scanThrottleMs) {
        await runtimeStore.touchDreamAttempt({ scopeKey, now, reason: "scan_throttle" });
        return { status: "skipped", reason: "scan_throttle" };
      }
    }

    const recentSessionIds = await runtimeStore.listScopedSessionIdsTouchedSince(
      scopeKey,
      state?.lastSuccessAt ?? 0,
      null,
      clampInt(config.minSessions * 4, 20),
    );
    if (!params.bypassGate && recentSessionIds.length < config.minSessions) {
      await runtimeStore.touchDreamAttempt({ scopeKey, now, reason: "min_sessions_gate" });
      return { status: "skipped", reason: "min_sessions_gate" };
    }

    await this.waitBeforeRun({
      scope: params.scope,
      ...(params.sessionId?.trim() ? { sessionId: params.sessionId.trim() } : {}),
      ...(params.sessionKey?.trim() ? { sessionKey: params.sessionKey.trim() } : {}),
      triggerSource: params.triggerSource,
    });

    const preview = await collectDreamInputs({
      runtimeStore,
      scope: params.scope,
      scopeKey,
      sessionIds: recentSessionIds,
      sessionLimit: params.sessionLimit,
      signalLimit: params.signalLimit,
    });

    if (params.dryRun) {
      return {
        status: "preview",
        reason: "dry_run_preview",
        preview,
      };
    }

    const lockOwner = newId("dream");
    const lock = await runtimeStore.acquireDreamLock({
      scopeKey,
      owner: lockOwner,
      staleAfterMs: config.lockStaleAfterMs,
      now,
    });
    if (!lock.acquired) {
      return { status: "skipped", reason: "lock_held" };
    }

    const runId = await runtimeStore.createMaintenanceRun({
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
      const result = await runner(
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
        },
        logger,
      );

      await runtimeStore.updateMaintenanceRun({
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
        }),
        ...(result.status === "failed" ? { error: result.summary ?? "dream failed" } : {}),
        finishedAt: Date.now(),
      });
      await runtimeStore.releaseDreamLock({
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
      await runtimeStore.updateMaintenanceRun({
        id: runId,
        status: "failed",
        summary: "Dream failed",
        error: summary,
        finishedAt: Date.now(),
      });
      await runtimeStore.releaseDreamLock({
        scopeKey,
        owner: lockOwner,
        runId,
        status: "failed",
      });
      logger.warn(`[memory] dream failed scope=${scopeKey} error=${summary}`);
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
