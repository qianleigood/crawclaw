import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { isSubagentSessionKey } from "../../sessions/session-key-utils.ts";
import { getSharedMemoryPromptJournal } from "../diagnostics/prompt-journal.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { DurableExtractionConfig } from "../types/config.ts";
import type { GmMessageRow } from "../types/runtime.ts";
import {
  classifyAfterTurnDurableSkipReason,
  shouldSkipAfterTurnDurableExtraction,
} from "./extraction.ts";
import { resolveDurableMemoryScope, type DurableMemoryScope } from "./scope.ts";

type RuntimeLogger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

export type DurableExtractionWorkerStatus =
  | "idle"
  | "scheduled"
  | "running"
  | "cooldown"
  | "stopped";

export type DurableExtractionWorkerPendingContext = {
  sessionId: string;
  sessionKey: string;
  sessionFile: string;
  workspaceDir: string;
  scope: DurableMemoryScope;
  parentRunId?: string;
  messageCursor: number;
};

export type DurableExtractionWorkerState = {
  sessionKey: string;
  status: DurableExtractionWorkerStatus;
  lastMessageCursor: number;
  lastRunCursor: number;
  inProgress: Promise<void> | null;
  pendingContext: DurableExtractionWorkerPendingContext | null;
  lastRunAt: number | null;
  lastTouchedAt: number;
  eligibleTurnsSinceLastRun: number;
  stopRequested: boolean;
};

export type DurableExtractionWorkerManagerStatus = {
  workerCount: number;
  runningCount: number;
  queuedCount: number;
  idleWorkers: number;
  cooldownWorkers: number;
  maxConcurrentWorkers: number;
  workerIdleTtlMs: number;
  minEligibleTurnsBetweenRuns: number;
};

export type DurableExtractionRunParams = {
  sessionId: string;
  sessionKey: string;
  sessionFile: string;
  workspaceDir: string;
  scope: DurableMemoryScope;
  parentRunId?: string;
  messageCursor: number;
  recentMessages: AgentMessage[];
  recentMessageLimit: number;
  maxNotes: number;
};

export type DurableExtractionRunResult = {
  status: "written" | "skipped" | "no_change" | "failed";
  notesSaved: number;
  reason?: string;
  advanceCursor: boolean;
};

export type DurableExtractionRunner = (
  params: DurableExtractionRunParams,
) => Promise<DurableExtractionRunResult>;

type SubmitTurnParams = {
  sessionId: string;
  sessionKey?: string;
  newMessages: AgentMessage[];
  messageCursor: number;
  runtimeContext?: {
    agentId?: string | null;
    messageChannel?: string | null;
    senderId?: string | null;
    parentRunId?: string | null;
    sessionFile?: string | null;
    workspaceDir?: string | null;
  };
};

type DurableExtractionWorkerManagerParams = {
  config: DurableExtractionConfig;
  runtimeStore: RuntimeStore;
  runner?: DurableExtractionRunner;
  logger: RuntimeLogger;
};

function nowMs(): number {
  return Date.now();
}

function clampInt(value: number | undefined, fallback: number, minimum = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(value));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class DurableExtractionWorkerManager {
  private config: DurableExtractionConfig;
  private runtimeStore: RuntimeStore;
  private runner?: DurableExtractionRunner;
  private logger: RuntimeLogger;
  private readonly workers = new Map<string, DurableExtractionWorkerState>();
  private readonly queue: string[] = [];
  private runningCount = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(params: DurableExtractionWorkerManagerParams) {
    this.config = params.config;
    this.runtimeStore = params.runtimeStore;
    this.runner = params.runner;
    this.logger = params.logger;
    this.startCleanupTimer();
  }

  reconfigure(params: DurableExtractionWorkerManagerParams): void {
    this.config = params.config;
    this.runtimeStore = params.runtimeStore;
    this.runner = params.runner;
    this.logger = params.logger;
    this.startCleanupTimer();
  }

  async submitTurn(params: SubmitTurnParams): Promise<void> {
    this.cleanupIdle();
    if (
      !this.config.enabled ||
      !this.runner ||
      !params.sessionKey?.trim() ||
      !params.newMessages.length
    ) {
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
    if (!scope) {
      getSharedMemoryPromptJournal()?.recordStage("after_turn_decision", {
        sessionId: params.sessionId,
        sessionKey,
        agentId: params.runtimeContext?.agentId ?? undefined,
        channel: params.runtimeContext?.messageChannel ?? undefined,
        userId: params.runtimeContext?.senderId ?? undefined,
        payload: {
          decision: "skip_no_scope",
          messageCursor: params.messageCursor,
        },
      });
      return;
    }
    const worker = this.getOrCreateWorker(sessionKey);
    worker.lastTouchedAt = nowMs();
    worker.lastMessageCursor = Math.max(worker.lastMessageCursor, params.messageCursor);

    if (shouldSkipAfterTurnDurableExtraction(params.newMessages)) {
      const skipReason = classifyAfterTurnDurableSkipReason(params.newMessages);
      worker.pendingContext = null;
      worker.eligibleTurnsSinceLastRun = 0;
      if (!worker.inProgress) {
        worker.status = "idle";
      }
      await this.runtimeStore.upsertDurableExtractionCursor({
        sessionId: params.sessionId,
        sessionKey,
        lastExtractedTurn: params.messageCursor,
        lastRunAt: nowMs(),
      });
      this.logger.info(
        `[memory] durable extraction skipped_direct_write sessionKey=${sessionKey} cursor=${params.messageCursor}`,
      );
      getSharedMemoryPromptJournal()?.recordStage("after_turn_decision", {
        sessionId: params.sessionId,
        sessionKey,
        agentId: scope.agentId,
        channel: scope.channel,
        userId: scope.userId,
        payload: {
          decision: "skip_direct_write",
          skipReason,
          messageCursor: params.messageCursor,
        },
      });
      return;
    }

    const visibleMessageCount = params.newMessages.filter((message) => {
      const role = (message as { role?: unknown }).role;
      return role === "user" || role === "assistant";
    }).length;
    if (visibleMessageCount < 1) {
      getSharedMemoryPromptJournal()?.recordStage("after_turn_decision", {
        sessionId: params.sessionId,
        sessionKey,
        agentId: scope.agentId,
        channel: scope.channel,
        userId: scope.userId,
        payload: {
          decision: "skip_no_visible_messages",
          messageCursor: params.messageCursor,
        },
      });
      return;
    }

    const nextPending: DurableExtractionWorkerPendingContext = {
      sessionId: params.sessionId,
      sessionKey,
      sessionFile:
        params.runtimeContext?.sessionFile?.trim() ||
        `${params.sessionId.trim() || "session"}.jsonl`,
      workspaceDir: params.runtimeContext?.workspaceDir?.trim() || process.cwd(),
      scope,
      ...(params.runtimeContext?.parentRunId?.trim()
        ? { parentRunId: params.runtimeContext.parentRunId.trim() }
        : {}),
      messageCursor: params.messageCursor,
    };
    if (worker.inProgress && worker.pendingContext) {
      this.logger.info(
        `[memory] durable extraction pending_overwritten sessionKey=${sessionKey} cursor=${params.messageCursor}`,
      );
    }
    worker.pendingContext = nextPending;
    worker.eligibleTurnsSinceLastRun += 1;

    if (worker.inProgress) {
      return;
    }

    const minTurnGap = this.normalizeMinEligibleTurnsBetweenRuns();
    if (worker.lastRunAt != null && worker.eligibleTurnsSinceLastRun < minTurnGap) {
      worker.status = "cooldown";
      this.logger.info(
        `[memory] durable extraction skipped_throttle sessionKey=${sessionKey} cursor=${params.messageCursor} minTurnGap=${minTurnGap}`,
      );
      getSharedMemoryPromptJournal()?.recordStage("after_turn_decision", {
        sessionId: params.sessionId,
        sessionKey,
        agentId: scope.agentId,
        channel: scope.channel,
        userId: scope.userId,
        payload: {
          decision: "skip_throttle",
          messageCursor: params.messageCursor,
          minTurnGap,
          eligibleTurnsSinceLastRun: worker.eligibleTurnsSinceLastRun,
        },
      });
      return;
    }

    worker.status = "scheduled";
    this.enqueue(sessionKey);
    getSharedMemoryPromptJournal()?.recordStage("after_turn_decision", {
      sessionId: params.sessionId,
      sessionKey,
      agentId: scope.agentId,
      channel: scope.channel,
      userId: scope.userId,
      payload: {
        decision: "scheduled",
        messageCursor: params.messageCursor,
        recentMessageCount: visibleMessageCount,
      },
    });
    this.pumpQueue();
  }

  async stopSession(
    sessionKey: string | undefined | null,
    opts?: { timeoutMs?: number },
  ): Promise<void> {
    const key = (sessionKey ?? "").trim();
    if (!key) {
      return;
    }
    const worker = this.workers.get(key);
    if (!worker) {
      return;
    }
    worker.stopRequested = true;
    worker.pendingContext = null;
    worker.status = worker.inProgress ? "stopped" : "stopped";
    this.dequeue(key);
    if (worker.inProgress) {
      try {
        await withTimeout(worker.inProgress, opts?.timeoutMs ?? 10_000);
      } catch {
        // Best effort on shutdown/reset paths.
      }
    }
    this.workers.delete(key);
  }

  cleanupIdle(): number {
    const ttlMs = this.normalizeWorkerIdleTtlMs();
    const cutoff = nowMs() - ttlMs;
    let removed = 0;
    for (const [sessionKey, worker] of this.workers.entries()) {
      if (worker.inProgress) {
        continue;
      }
      if (worker.lastTouchedAt >= cutoff) {
        continue;
      }
      this.dequeue(sessionKey);
      worker.pendingContext = null;
      worker.status = "stopped";
      this.workers.delete(sessionKey);
      removed += 1;
      this.logger.info(`[memory] durable extraction worker_idle_cleanup sessionKey=${sessionKey}`);
    }
    return removed;
  }

  async drainAll(timeoutMs = 15_000): Promise<void> {
    const deadline = nowMs() + Math.max(1, timeoutMs);
    while (true) {
      this.cleanupIdle();
      for (const worker of this.workers.values()) {
        if (!worker.inProgress && worker.pendingContext && worker.status !== "scheduled") {
          worker.status = "scheduled";
          this.enqueue(worker.sessionKey);
        }
      }
      this.pumpQueue();
      const inFlight = [...this.workers.values()]
        .map((worker) => worker.inProgress)
        .filter((value): value is Promise<void> => Boolean(value));
      const pendingCount = [...this.workers.values()].filter(
        (worker) => worker.pendingContext,
      ).length;
      if (!inFlight.length && pendingCount === 0 && this.queue.length === 0) {
        return;
      }
      const remaining = deadline - nowMs();
      if (remaining <= 0) {
        throw new Error("Timed out draining durable extraction workers");
      }
      if (inFlight.length > 0) {
        await withTimeout(
          Promise.allSettled(inFlight).then(() => undefined),
          remaining,
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 50)));
      }
    }
  }

  getStatus(): DurableExtractionWorkerManagerStatus {
    this.cleanupIdle();
    const workers = [...this.workers.values()];
    return {
      workerCount: workers.length,
      runningCount: workers.filter((worker) => worker.status === "running").length,
      queuedCount: workers.filter((worker) => worker.status === "scheduled").length,
      idleWorkers: workers.filter((worker) => worker.status === "idle").length,
      cooldownWorkers: workers.filter((worker) => worker.status === "cooldown").length,
      maxConcurrentWorkers: this.normalizeMaxConcurrentWorkers(),
      workerIdleTtlMs: this.normalizeWorkerIdleTtlMs(),
      minEligibleTurnsBetweenRuns: this.normalizeMinEligibleTurnsBetweenRuns(),
    };
  }

  async dispose(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const sessionKey of this.workers.keys()) {
      await this.stopSession(sessionKey, { timeoutMs: 1_000 });
    }
  }

  private getOrCreateWorker(sessionKey: string): DurableExtractionWorkerState {
    const existing = this.workers.get(sessionKey);
    if (existing) {
      return existing;
    }
    const created: DurableExtractionWorkerState = {
      sessionKey,
      status: "idle",
      lastMessageCursor: 0,
      lastRunCursor: 0,
      inProgress: null,
      pendingContext: null,
      lastRunAt: null,
      lastTouchedAt: nowMs(),
      eligibleTurnsSinceLastRun: 0,
      stopRequested: false,
    };
    this.workers.set(sessionKey, created);
    return created;
  }

  private enqueue(sessionKey: string): void {
    if (this.queue.includes(sessionKey)) {
      return;
    }
    this.queue.push(sessionKey);
  }

  private dequeue(sessionKey: string): void {
    const index = this.queue.indexOf(sessionKey);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }

  private pumpQueue(): void {
    while (this.runningCount < this.normalizeMaxConcurrentWorkers()) {
      const nextSessionKey = this.queue.shift();
      if (!nextSessionKey) {
        return;
      }
      const worker = this.workers.get(nextSessionKey);
      if (
        !worker ||
        worker.stopRequested ||
        worker.status !== "scheduled" ||
        !worker.pendingContext ||
        worker.inProgress
      ) {
        continue;
      }
      this.startWorkerRun(worker);
    }
  }

  private startWorkerRun(worker: DurableExtractionWorkerState): void {
    const pending = worker.pendingContext;
    if (!pending || !this.runner) {
      worker.status = worker.stopRequested ? "stopped" : "idle";
      return;
    }
    worker.pendingContext = null;
    worker.status = "running";
    worker.lastTouchedAt = nowMs();
    worker.lastRunCursor = Math.max(worker.lastRunCursor, pending.messageCursor);
    worker.eligibleTurnsSinceLastRun = 0;
    this.runningCount += 1;

    worker.inProgress = (async () => {
      try {
        const cursor = await this.runtimeStore.getDurableExtractionCursor(pending.sessionId);
        const recentMessageLimit = this.normalizeRecentMessageLimit();
        const recentMessages = await this.runtimeStore.listModelVisibleMessagesForDurableExtraction(
          pending.sessionId,
          cursor?.lastExtractedTurn ?? 0,
          pending.messageCursor,
          recentMessageLimit,
        );
        const recentAgentMessages = recentMessages.map((row) => this.mapRowToAgentMessage(row));
        const result = await this.runWithAgentRunner({
          pending,
          recentMessages: recentAgentMessages,
          recentMessageLimit,
        });
        if (result.advanceCursor) {
          await this.runtimeStore.upsertDurableExtractionCursor({
            sessionId: pending.sessionId,
            sessionKey: pending.sessionKey,
            lastExtractedTurn: pending.messageCursor,
            lastExtractedMessageId: recentMessages.at(-1)?.id ?? null,
            lastRunAt: nowMs(),
          });
        }
        if (result.notesSaved > 0) {
          this.logger.info(
            `[memory] durable extraction memories_saved sessionKey=${pending.sessionKey} cursor=${pending.messageCursor} count=${result.notesSaved}`,
          );
        } else if (result.status === "failed") {
          this.logger.warn(
            `[memory] durable extraction failed sessionKey=${pending.sessionKey} cursor=${pending.messageCursor}${result.reason ? ` reason=${result.reason}` : ""}`,
          );
        } else {
          this.logger.info(
            `[memory] durable extraction no_memories_saved sessionKey=${pending.sessionKey} cursor=${pending.messageCursor}${result.reason ? ` reason=${result.reason}` : ""}`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `[memory] durable extraction error sessionKey=${pending.sessionKey} cursor=${pending.messageCursor} | ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        worker.inProgress = null;
        worker.lastRunAt = nowMs();
        worker.lastTouchedAt = nowMs();
        this.runningCount = Math.max(0, this.runningCount - 1);
        if (worker.stopRequested) {
          worker.status = "stopped";
          this.workers.delete(worker.sessionKey);
          this.dequeue(worker.sessionKey);
        } else if (worker.pendingContext) {
          const minTurnGap = this.normalizeMinEligibleTurnsBetweenRuns();
          if (worker.eligibleTurnsSinceLastRun >= minTurnGap) {
            worker.status = "scheduled";
            this.enqueue(worker.sessionKey);
          } else {
            worker.status = "cooldown";
          }
        } else {
          worker.status = "idle";
        }
        this.pumpQueue();
      }
    })();
  }

  private normalizeRecentMessageLimit(): number {
    return clampInt(this.config.recentMessageLimit, 24, 1);
  }

  private normalizeMaxNotesPerTurn(): number {
    return clampInt(this.config.maxNotesPerTurn, 2, 1);
  }

  private normalizeMinEligibleTurnsBetweenRuns(): number {
    return clampInt(this.config.minEligibleTurnsBetweenRuns, 1, 1);
  }

  private normalizeMaxConcurrentWorkers(): number {
    return clampInt(this.config.maxConcurrentWorkers, 2, 1);
  }

  private normalizeWorkerIdleTtlMs(): number {
    return clampInt(this.config.workerIdleTtlMs, 15 * 60_000, 1);
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    const intervalMs = Math.max(
      5_000,
      Math.min(60_000, Math.floor(this.normalizeWorkerIdleTtlMs() / 2)),
    );
    this.cleanupTimer = setInterval(() => {
      try {
        this.cleanupIdle();
      } catch (error) {
        this.logger.warn(
          `[memory] durable extraction cleanup error | ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }, intervalMs);
    this.cleanupTimer.unref?.();
  }

  private mapRowToAgentMessage(row: GmMessageRow): AgentMessage {
    return {
      role: row.role as "user" | "assistant",
      content: row.contentBlocks?.length ? row.contentBlocks : (row.contentText ?? row.content),
    } as AgentMessage;
  }

  private async runWithAgentRunner(params: {
    pending: DurableExtractionWorkerPendingContext;
    recentMessages: AgentMessage[];
    recentMessageLimit: number;
  }): Promise<DurableExtractionRunResult> {
    try {
      const result = await this.runner!({
        sessionId: params.pending.sessionId,
        sessionKey: params.pending.sessionKey,
        sessionFile: params.pending.sessionFile,
        workspaceDir: params.pending.workspaceDir,
        scope: params.pending.scope,
        ...(params.pending.parentRunId ? { parentRunId: params.pending.parentRunId } : {}),
        messageCursor: params.pending.messageCursor,
        recentMessages: params.recentMessages,
        recentMessageLimit: params.recentMessageLimit,
        maxNotes: this.normalizeMaxNotesPerTurn(),
      });
      return result;
    } catch (error) {
      return {
        status: "failed",
        notesSaved: 0,
        reason: error instanceof Error ? error.message : String(error),
        advanceCursor: false,
      };
    }
  }
}

let sharedManager: DurableExtractionWorkerManager | null = null;

export function getSharedDurableExtractionWorkerManager(
  params: DurableExtractionWorkerManagerParams,
): DurableExtractionWorkerManager {
  if (!sharedManager) {
    sharedManager = new DurableExtractionWorkerManager(params);
  } else {
    sharedManager.reconfigure(params);
  }
  return sharedManager;
}

export async function drainSharedDurableExtractionWorkers(timeoutMs?: number): Promise<void> {
  if (!sharedManager) {
    return;
  }
  await sharedManager.drainAll(timeoutMs);
}

export async function stopSharedDurableExtractionWorkerForSession(
  sessionKey: string | undefined | null,
  opts?: { timeoutMs?: number },
): Promise<void> {
  if (!sharedManager) {
    return;
  }
  await sharedManager.stopSession(sessionKey, opts);
}

export function getSharedDurableExtractionWorkerManagerStatus(): DurableExtractionWorkerManagerStatus | null {
  return sharedManager?.getStatus() ?? null;
}

export async function cleanupSharedDurableExtractionWorkers(): Promise<void> {
  if (!sharedManager) {
    return;
  }
  await sharedManager.dispose();
  sharedManager = null;
}

export const __testing = {
  resetSharedDurableExtractionWorkerManager: async () => {
    await cleanupSharedDurableExtractionWorkers();
  },
};
