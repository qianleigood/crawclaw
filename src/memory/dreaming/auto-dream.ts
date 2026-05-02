import fs from "node:fs/promises";
import path from "node:path";
import {
  resolveDefaultSessionStorePath,
  resolveSessionTranscriptPath,
  resolveSessionTranscriptsDirForAgent,
} from "../../config/sessions/paths.js";
import { loadSessionStore } from "../../config/sessions/store.js";
import type { ObservationContext } from "../../infra/observation/types.js";
import { buildRandomTempFilePath } from "../../plugin-sdk/temp-path.js";
import { isMemoryAutomationExcludedSessionKey } from "../../sessions/session-key-utils.ts";
import { resolveDurableMemoryScope, type DurableMemoryScope } from "../durable/scope.ts";
import { scanDurableMemoryScopeEntries } from "../durable/store.ts";
import { resolveMemoryMessageChannel } from "../engine/context-memory-runtime-helpers.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { DreamingConfig } from "../types/config.ts";
import { newId } from "../util/ids.ts";
import type {
  DreamRunParams,
  DreamRunResult,
  DreamSignal,
  DreamTranscriptRef,
} from "./agent-runner.ts";
import {
  markDreamConsolidationSucceeded,
  readDreamConsolidationStatus,
  rollbackDreamConsolidationLock,
  tryAcquireDreamConsolidationLock,
} from "./consolidation-lock.ts";

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
    observation?: ObservationContext;
  };
};

type RunAutoDreamNowParams = {
  scope: DurableMemoryScope;
  sessionId?: string;
  sessionFile?: string;
  workspaceDir?: string;
  sessionKey?: string;
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
  recentTranscriptRefCount: number;
  recentSignalCount: number;
  recentSignals: DreamSignal[];
  transcriptRefs: DreamTranscriptRef[];
};

type RecentTranscriptCandidate = {
  sessionId: string;
  mtimeMs: number;
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

function includeTriggeringStopSession(params: {
  sessionIds: string[];
  sessionId?: string;
  triggerSource: string;
}): string[] {
  const triggeringSessionId = params.triggerSource === "stop" ? params.sessionId?.trim() || "" : "";
  if (!triggeringSessionId) {
    return params.sessionIds;
  }
  return [
    triggeringSessionId,
    ...params.sessionIds.filter((sessionId) => sessionId !== triggeringSessionId),
  ];
}

function collectScopedSessionIds(scope: DurableMemoryScope): Set<string> {
  let store: ReturnType<typeof loadSessionStore>;
  try {
    store = loadSessionStore(resolveDefaultSessionStorePath(scope.agentId), { skipCache: true });
  } catch {
    return new Set<string>();
  }
  const sessionIds = new Set<string>();
  for (const [sessionKey, entry] of Object.entries(store)) {
    const sessionId = typeof entry?.sessionId === "string" ? entry.sessionId.trim() : "";
    if (!sessionId) {
      continue;
    }
    const entryScope = resolveDurableMemoryScope({ sessionKey });
    if (entryScope?.scopeKey === scope.scopeKey) {
      sessionIds.add(sessionId);
    }
  }
  return sessionIds;
}

async function collectRecentTranscriptSessionIds(params: {
  scope: DurableMemoryScope;
  sinceTime: number;
  excludeSessionId?: string | null;
  limit?: number | null;
}): Promise<string[]> {
  const scopedSessionIds = collectScopedSessionIds(params.scope);
  if (scopedSessionIds.size === 0) {
    return [];
  }
  const sessionsDir = resolveSessionTranscriptsDirForAgent(params.scope.agentId);
  let entries: Array<{ name: string; isFile(): boolean }>;
  try {
    entries = await fs.readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const candidates: RecentTranscriptCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const sessionId = entry.name.slice(0, -".jsonl".length);
    if (!sessionId || sessionId === params.excludeSessionId || !scopedSessionIds.has(sessionId)) {
      continue;
    }
    const filePath = path.join(sessionsDir, entry.name);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (stat.mtimeMs <= params.sinceTime) {
      continue;
    }
    candidates.push({ sessionId, mtimeMs: stat.mtimeMs });
  }
  const sorted = candidates.toSorted(
    (left, right) => right.mtimeMs - left.mtimeMs || left.sessionId.localeCompare(right.sessionId),
  );
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0
      ? Math.floor(params.limit)
      : null;
  return (limit == null ? sorted : sorted.slice(0, limit)).map((entry) => entry.sessionId);
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

function collectRecentTranscriptRefs(params: {
  scope: DurableMemoryScope;
  sessionIds: string[];
}): DreamTranscriptRef[] {
  return params.sessionIds.map((sessionId) => ({
    sessionId,
    path: resolveSessionTranscriptPath(sessionId, params.scope.agentId),
  }));
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
  const sessionIds =
    params.sessionLimit === undefined
      ? params.sessionIds
      : params.sessionIds.slice(0, Math.max(1, params.sessionLimit));
  const transcriptRefs = collectRecentTranscriptRefs({
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
    recentSessionCount: sessionIds.length,
    recentTranscriptRefCount: transcriptRefs.length,
    recentSignalCount: recentSignals.length,
    recentSignals,
    transcriptRefs,
  };
}

export class AutoDreamScheduler {
  private config: DreamingConfig;
  private runtimeStore: RuntimeStore;
  private runner?: AutoDreamRunner;
  private logger: RuntimeLogger;
  private beforeRun?: AutoDreamBeforeRun;
  private readonly inFlightScopes = new Set<string>();
  private readonly lastScanAtByScope = new Map<string, number>();

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
    this.inFlightScopes.add(scope.scopeKey);
    void this.runNow({
      scope,
      sessionId: params.sessionId,
      ...(params.sessionFile?.trim() ? { sessionFile: params.sessionFile.trim() } : {}),
      ...(params.workspaceDir?.trim() ? { workspaceDir: params.workspaceDir.trim() } : {}),
      sessionKey,
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
    const consolidationStatus = await readDreamConsolidationStatus({
      scope: params.scope,
      staleAfterMs: config.lockStaleAfterMs,
      now,
    });
    const lastConsolidatedAt = consolidationStatus.lastConsolidatedAt ?? 0;
    if (!params.bypassGate) {
      const minIntervalMs = Math.max(0, config.minHours) * 3_600_000;
      if (lastConsolidatedAt > 0 && now - lastConsolidatedAt < minIntervalMs) {
        return { status: "skipped", reason: "min_hours_gate" };
      }
      const lastScanAt = this.lastScanAtByScope.get(scopeKey);
      if (lastScanAt != null && now - lastScanAt < config.scanThrottleMs) {
        return { status: "skipped", reason: "scan_throttle" };
      }
    }
    this.lastScanAtByScope.set(scopeKey, now);

    const historicalSessionIds = await collectRecentTranscriptSessionIds({
      scope: params.scope,
      sinceTime: lastConsolidatedAt,
      excludeSessionId: params.sessionId,
    });
    const recentSessionIds = includeTriggeringStopSession({
      sessionIds: historicalSessionIds,
      sessionId: params.sessionId,
      triggerSource: params.triggerSource,
    });
    if (!params.bypassGate && recentSessionIds.length < config.minSessions) {
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
    const lock = await tryAcquireDreamConsolidationLock({
      scope: params.scope,
      owner: lockOwner,
      staleAfterMs: config.lockStaleAfterMs,
      now,
    });
    if (!lock.acquired) {
      return { status: "skipped", reason: "lock_held" };
    }

    const runId = lockOwner;

    const dreamSessionId =
      params.sessionId?.trim() || preview.recentSessionIds[0]?.trim() || `dream-${scopeKey}`;
    const dreamWorkspaceDir = params.workspaceDir?.trim() || process.cwd();
    const dreamSessionFile =
      params.sessionFile?.trim() ||
      buildRandomTempFilePath({
        prefix: dreamSessionId,
        extension: ".jsonl",
      });

    try {
      const result = await runner(
        {
          runId,
          sessionId: dreamSessionId,
          sessionFile: dreamSessionFile,
          workspaceDir: dreamWorkspaceDir,
          scope: params.scope,
          sessionKey: params.sessionKey,
          triggerSource: params.triggerSource,
          lastSuccessAt: consolidationStatus.lastConsolidatedAt,
          recentTranscriptRefs: preview.transcriptRefs,
          recentSignals: preview.recentSignals,
        },
        logger,
      );

      if (result.status === "failed") {
        await rollbackDreamConsolidationLock(lock.lock);
      } else {
        await markDreamConsolidationSucceeded(lock.lock);
      }
      return {
        status: result.status === "failed" ? "failed" : "started",
        reason: result.summary,
        runId,
      };
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      await rollbackDreamConsolidationLock(lock.lock);
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
