import type { ContextArchiveService } from "../../agents/context-archive/service.js";
import { createContextArchiveTurnCapture } from "../../agents/context-archive/turn-capture.js";
import { renderAgentMemoryRoutingContract } from "../context/render-routing-guidance.ts";
import { getSharedAutoDreamScheduler } from "../dreaming/auto-dream.ts";
import type { AutoDreamRunner } from "../dreaming/auto-dream.ts";
import { getSharedAutoDreamLifecycleSubscriber } from "../dreaming/lifecycle-subscriber.ts";
import { getSharedDurableExtractionLifecycleSubscriber } from "../durable/lifecycle-subscriber.ts";
import { getSharedDurableExtractionWorkerManager } from "../durable/worker-manager.ts";
import type { DurableExtractionRunner } from "../durable/worker-manager.ts";
import { getSharedExperienceExtractionLifecycleSubscriber } from "../experience/lifecycle-subscriber.ts";
import { createDefaultExperienceProviderRegistry } from "../experience/provider.ts";
import {
  getSharedExperienceExtractionWorkerManager,
  type ExperienceExtractionRunner,
} from "../experience/worker-manager.ts";
import { createCompleteFn, type CompleteFn } from "../extraction/llm.ts";
import { IngestCoordinator } from "../ingest/ingest-coordinator.ts";
import { UnifiedContextAssembler } from "../orchestration/context-assembler.ts";
import { UnifiedQueryClassifier } from "../orchestration/query-classifier.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { getSharedSessionSummaryLifecycleSubscriber } from "../session-summary/lifecycle-subscriber.ts";
import { getSharedSessionSummaryScheduler } from "../session-summary/scheduler.ts";
import type { SessionSummaryRunner } from "../session-summary/scheduler.ts";
import { SkillIndexStore } from "../skills/skill-index.ts";
import type { MemoryRuntimeConfig, LlmConfig } from "../types/config.ts";

export type RuntimeLogger = {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
};

export function createContextMemoryRuntimeDeps(options: {
  runtimeStore: RuntimeStore;
  logger: RuntimeLogger;
  config?: MemoryRuntimeConfig;
  llm?: LlmConfig;
  complete?: CompleteFn;
  durableExtractionRunner?: DurableExtractionRunner;
  experienceExtractionRunner?: ExperienceExtractionRunner;
  dreamRunner?: AutoDreamRunner;
  sessionSummaryRunner?: SessionSummaryRunner;
  contextArchive?: Pick<ContextArchiveService, "createRun" | "appendEvent">;
}) {
  const structuredComplete =
    options.complete ??
    (options.llm
      ? createCompleteFn(
          options.llm.model ?? process.env.GM_NEO4J_DEFAULT_MODEL ?? "gpt-5.4",
          options.llm,
        )
      : undefined);
  const ingestCoordinator = new IngestCoordinator({
    runtimeStore: options.runtimeStore,
    config: options.config,
  });
  const queryClassifier = new UnifiedQueryClassifier();
  const contextAssembler = new UnifiedContextAssembler();
  const experienceProviderRegistry = createDefaultExperienceProviderRegistry({
    notebooklm: options.config?.notebooklm,
    logger: options.logger,
  });
  const skillIndexStore = new SkillIndexStore({
    workspaceDir: process.cwd(),
    extraRoots: options.config?.skillRouting.extraRoots,
    logger: options.logger,
    ttlMs: options.config?.skillRouting.ttlMs,
  });
  const agentMemoryRoutingContract = renderAgentMemoryRoutingContract();
  const contextArchiveTurnCapture = createContextArchiveTurnCapture({
    archive: options.contextArchive,
  });
  const durableExtractionManager = getSharedDurableExtractionWorkerManager({
    config: options.config?.durableExtraction ?? {
      enabled: false,
      recentMessageLimit: 24,
      maxNotesPerTurn: 2,
      minEligibleTurnsBetweenRuns: 1,
      maxConcurrentWorkers: 2,
      workerIdleTtlMs: 15 * 60_000,
    },
    runtimeStore: options.runtimeStore,
    runner: options.durableExtractionRunner,
    logger: options.logger,
  });
  const experienceExtractionManager = getSharedExperienceExtractionWorkerManager({
    config: options.config?.experience ?? {
      enabled: false,
      recentMessageLimit: 24,
      maxNotesPerTurn: 2,
      minEligibleTurnsBetweenRuns: 1,
      maxConcurrentWorkers: 2,
      workerIdleTtlMs: 15 * 60_000,
    },
    runtimeStore: options.runtimeStore,
    runner: options.experienceExtractionRunner,
    logger: options.logger,
  });
  const autoDreamScheduler = getSharedAutoDreamScheduler({
    config: options.config?.dreaming ?? {
      enabled: false,
      minHours: 24,
      minSessions: 5,
      scanThrottleMs: 10 * 60_000,
      lockStaleAfterMs: 60 * 60_000,
    },
    runtimeStore: options.runtimeStore,
    runner: options.dreamRunner,
    logger: options.logger,
  });
  const sessionSummaryScheduler = getSharedSessionSummaryScheduler({
    config: {
      enabled: options.config?.sessionSummary?.enabled ?? true,
      lightInitialTokenThreshold: options.config?.sessionSummary?.lightInitTokenThreshold ?? 3_000,
      initialTokenThreshold: options.config?.sessionSummary?.minTokensToInit ?? 10_000,
      updateTokenThreshold: options.config?.sessionSummary?.minTokensBetweenUpdates ?? 5_000,
      minToolCalls: options.config?.sessionSummary?.toolCallsBetweenUpdates ?? 3,
      minIntervalMs: 0,
      runTimeoutSeconds: options.config?.sessionSummary?.maxWaitMs
        ? Math.max(90, Math.floor(options.config.sessionSummary.maxWaitMs / 1000))
        : 90,
      maxTurns: options.config?.sessionSummary?.maxTurns ?? 5,
    },
    runtimeStore: options.runtimeStore,
    runner: options.sessionSummaryRunner,
    logger: options.logger,
  });

  getSharedSessionSummaryLifecycleSubscriber({
    runtimeStore: options.runtimeStore,
    scheduler: sessionSummaryScheduler,
    logger: options.logger,
  });
  getSharedDurableExtractionLifecycleSubscriber({
    runtimeStore: options.runtimeStore,
    manager: durableExtractionManager,
    logger: options.logger,
  });
  getSharedExperienceExtractionLifecycleSubscriber({
    runtimeStore: options.runtimeStore,
    manager: experienceExtractionManager,
    logger: options.logger,
  });
  getSharedAutoDreamLifecycleSubscriber({
    scheduler: autoDreamScheduler,
    logger: options.logger,
  });

  return {
    structuredComplete,
    ingestCoordinator,
    queryClassifier,
    contextAssembler,
    experienceProviderRegistry,
    skillIndexStore,
    agentMemoryRoutingContract,
    contextArchiveTurnCapture,
    durableExtractionManager,
    experienceExtractionManager,
    autoDreamScheduler,
    sessionSummaryScheduler,
  };
}
