import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { SpecialAgentParentForkContext } from "../../agents/special/runtime/parent-fork-context.js";
import { isSubagentSessionKey } from "../../sessions/session-key-utils.ts";
import { getSharedMemoryPromptJournal } from "../diagnostics/prompt-journal.js";
import { resolveDurableMemoryScope, type DurableMemoryScope } from "../durable/scope.js";
import type { RuntimeStore } from "../runtime/runtime-store.js";
import type { ExperienceExtractionConfig } from "../types/config.js";
import type { GmMessageRow } from "../types/runtime.js";
import type {
  ExperienceExtractionRunParams,
  ExperienceExtractionRunResult,
} from "./agent-runner.js";

type RuntimeLogger = { info(msg: string): void; warn(msg: string): void; error(msg: string): void };

export type {
  ExperienceExtractionRunParams,
  ExperienceExtractionRunResult,
} from "./agent-runner.js";

export type ExperienceExtractionRunner = (
  params: ExperienceExtractionRunParams,
) => Promise<ExperienceExtractionRunResult>;

type PendingContext = {
  sessionId: string;
  sessionKey: string;
  sessionFile: string;
  workspaceDir: string;
  scope: DurableMemoryScope;
  parentRunId?: string;
  parentForkContext?: SpecialAgentParentForkContext;
  messageCursor: number;
};

type WorkerState = {
  sessionKey: string;
  inProgress: Promise<void> | null;
  pendingContext: PendingContext | null;
  lastRunAt: number | null;
  lastTouchedAt: number;
  eligibleTurnsSinceLastRun: number;
};

export type ExperienceExtractionWorkerManagerStatus = {
  workerCount: number;
  runningCount: number;
  queuedCount: number;
  maxConcurrentWorkers: number;
  minEligibleTurnsBetweenRuns: number;
};

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
    parentForkContext?: SpecialAgentParentForkContext | null;
    sessionFile?: string | null;
    workspaceDir?: string | null;
  };
};

type ExperienceExtractionWorkerManagerParams = {
  config: ExperienceExtractionConfig;
  runtimeStore: RuntimeStore;
  runner?: ExperienceExtractionRunner;
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

function mapRowToAgentMessage(row: GmMessageRow): AgentMessage {
  return {
    role: row.role,
    content: row.contentBlocks?.length ? row.contentBlocks : (row.contentText ?? row.content),
  } as AgentMessage;
}

function hasExperienceSignal(messages: AgentMessage[]): boolean {
  const text = messages
    .map((message) => {
      const content = (message as { content?: unknown }).content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .map((part) =>
            part &&
            typeof part === "object" &&
            typeof (part as { text?: unknown }).text === "string"
              ? (part as { text: string }).text
              : "",
          )
          .join(" ");
      }
      return "";
    })
    .join("\n");
  return /(经验|复盘|教训|已验证|以后.*先|下次.*先|failure|lesson|validated|postmortem|runbook|SOP)/i.test(
    text,
  );
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

export class ExperienceExtractionWorkerManager {
  private config: ExperienceExtractionConfig;
  private runtimeStore: RuntimeStore;
  private runner?: ExperienceExtractionRunner;
  private logger: RuntimeLogger;
  private readonly workers = new Map<string, WorkerState>();
  private readonly queue: string[] = [];
  private runningCount = 0;

  constructor(params: ExperienceExtractionWorkerManagerParams) {
    this.config = params.config;
    this.runtimeStore = params.runtimeStore;
    this.runner = params.runner;
    this.logger = params.logger;
  }

  reconfigure(params: ExperienceExtractionWorkerManagerParams): void {
    this.config = params.config;
    this.runtimeStore = params.runtimeStore;
    this.runner = params.runner;
    this.logger = params.logger;
  }

  submitTurn(params: SubmitTurnParams): void {
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
    if (!hasExperienceSignal(params.newMessages)) {
      getSharedMemoryPromptJournal()?.recordStage("experience_extract", {
        sessionId: params.sessionId,
        sessionKey,
        payload: { decision: "skip_no_experience_signal", messageCursor: params.messageCursor },
      });
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
    const worker = this.getOrCreateWorker(sessionKey);
    worker.lastTouchedAt = nowMs();
    worker.pendingContext = {
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
      ...(params.runtimeContext?.parentForkContext
        ? { parentForkContext: params.runtimeContext.parentForkContext }
        : {}),
      messageCursor: params.messageCursor,
    };
    worker.eligibleTurnsSinceLastRun += 1;
    if (worker.inProgress) {
      return;
    }
    const minTurnGap = clampInt(this.config.minEligibleTurnsBetweenRuns, 1);
    if (worker.lastRunAt != null && worker.eligibleTurnsSinceLastRun < minTurnGap) {
      getSharedMemoryPromptJournal()?.recordStage("experience_extract", {
        sessionId: params.sessionId,
        sessionKey,
        agentId: scope.agentId,
        channel: scope.channel,
        userId: scope.userId,
        payload: { decision: "skip_throttle", messageCursor: params.messageCursor, minTurnGap },
      });
      return;
    }
    this.enqueue(sessionKey);
    getSharedMemoryPromptJournal()?.recordStage("experience_extract", {
      sessionId: params.sessionId,
      sessionKey,
      agentId: scope.agentId,
      channel: scope.channel,
      userId: scope.userId,
      payload: { decision: "scheduled", messageCursor: params.messageCursor },
    });
    this.pumpQueue();
  }

  async drainAll(timeoutMs = 15_000): Promise<void> {
    const deadline = nowMs() + Math.max(1, timeoutMs);
    while (true) {
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
        throw new Error("Timed out draining experience extraction workers");
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

  getStatus(): ExperienceExtractionWorkerManagerStatus {
    const workers = [...this.workers.values()];
    return {
      workerCount: workers.length,
      runningCount: workers.filter((worker) => worker.inProgress).length,
      queuedCount: this.queue.length,
      maxConcurrentWorkers: clampInt(this.config.maxConcurrentWorkers, 2),
      minEligibleTurnsBetweenRuns: clampInt(this.config.minEligibleTurnsBetweenRuns, 1),
    };
  }

  private getOrCreateWorker(sessionKey: string): WorkerState {
    const existing = this.workers.get(sessionKey);
    if (existing) {
      return existing;
    }
    const created: WorkerState = {
      sessionKey,
      inProgress: null,
      pendingContext: null,
      lastRunAt: null,
      lastTouchedAt: nowMs(),
      eligibleTurnsSinceLastRun: 0,
    };
    this.workers.set(sessionKey, created);
    return created;
  }

  private enqueue(sessionKey: string): void {
    if (!this.queue.includes(sessionKey)) {
      this.queue.push(sessionKey);
    }
  }

  private pumpQueue(): void {
    while (this.runningCount < clampInt(this.config.maxConcurrentWorkers, 2)) {
      const sessionKey = this.queue.shift();
      if (!sessionKey) {
        return;
      }
      const worker = this.workers.get(sessionKey);
      if (!worker?.pendingContext || worker.inProgress) {
        continue;
      }
      this.startWorkerRun(worker);
    }
  }

  private startWorkerRun(worker: WorkerState): void {
    const pending = worker.pendingContext;
    const runner = this.runner;
    if (!pending || !runner) {
      return;
    }
    worker.pendingContext = null;
    worker.eligibleTurnsSinceLastRun = 0;
    this.runningCount += 1;
    worker.inProgress = (async () => {
      let runId = "";
      try {
        runId = await this.runtimeStore.createMaintenanceRun({
          kind: "experience_extraction",
          status: "running",
          scope: pending.scope.scopeKey ?? pending.sessionKey,
          triggerSource: "stop",
          summary: "Experience extraction running",
        });
        const recentRows = await this.runtimeStore.listModelVisibleMessagesForDurableExtraction(
          pending.sessionId,
          0,
          pending.messageCursor,
          clampInt(this.config.recentMessageLimit, 24),
        );
        const result = await runner({
          runId,
          sessionId: pending.sessionId,
          sessionKey: pending.sessionKey,
          sessionFile: pending.sessionFile,
          workspaceDir: pending.workspaceDir,
          scope: pending.scope,
          ...(pending.parentRunId ? { parentRunId: pending.parentRunId } : {}),
          ...(pending.parentForkContext ? { parentForkContext: pending.parentForkContext } : {}),
          messageCursor: pending.messageCursor,
          recentMessages: recentRows.map(mapRowToAgentMessage),
          recentMessageLimit: clampInt(this.config.recentMessageLimit, 24),
          maxNotes: clampInt(this.config.maxNotesPerTurn, 2),
        });
        await this.runtimeStore.updateMaintenanceRun({
          id: runId,
          status: result.status === "failed" ? "failed" : "done",
          summary: result.summary ?? "Experience extraction completed",
          metricsJson: JSON.stringify({
            messageCursor: pending.messageCursor,
            writtenCount: result.writtenCount,
            updatedCount: result.updatedCount,
            deletedCount: result.deletedCount,
            touchedNotes: result.touchedNotes ?? [],
          }),
          ...(result.status === "failed" ? { error: result.summary ?? "experience failed" } : {}),
          finishedAt: nowMs(),
        });
        getSharedMemoryPromptJournal()?.recordStage("experience_extract", {
          sessionId: pending.sessionId,
          sessionKey: pending.sessionKey,
          agentId: pending.scope.agentId,
          channel: pending.scope.channel,
          userId: pending.scope.userId,
          payload: {
            status: result.status,
            messageCursor: pending.messageCursor,
            writtenCount: result.writtenCount,
            updatedCount: result.updatedCount,
            deletedCount: result.deletedCount,
            touchedNotes: result.touchedNotes ?? [],
          },
        });
      } catch (error) {
        const summary = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[memory] experience extraction failed sessionKey=${pending.sessionKey} error=${summary}`,
        );
        if (runId) {
          await this.runtimeStore.updateMaintenanceRun({
            id: runId,
            status: "failed",
            summary: "Experience extraction failed",
            error: summary,
            finishedAt: nowMs(),
          });
        }
      } finally {
        worker.lastRunAt = nowMs();
        worker.inProgress = null;
        this.runningCount = Math.max(0, this.runningCount - 1);
        this.pumpQueue();
      }
    })();
  }
}

let sharedExperienceExtractionWorkerManager: ExperienceExtractionWorkerManager | null = null;

export function getSharedExperienceExtractionWorkerManager(
  params: ExperienceExtractionWorkerManagerParams,
): ExperienceExtractionWorkerManager {
  if (!sharedExperienceExtractionWorkerManager) {
    sharedExperienceExtractionWorkerManager = new ExperienceExtractionWorkerManager(params);
    return sharedExperienceExtractionWorkerManager;
  }
  sharedExperienceExtractionWorkerManager.reconfigure(params);
  return sharedExperienceExtractionWorkerManager;
}

export async function drainSharedExperienceExtractionWorkers(timeoutMs?: number): Promise<void> {
  await sharedExperienceExtractionWorkerManager?.drainAll(timeoutMs);
}

export const __testing = {
  async resetSharedExperienceExtractionWorkerManager(): Promise<void> {
    sharedExperienceExtractionWorkerManager = null;
  },
};
