import type {
  QueryContextMemoryRecallDiagnostics,
  QueryContextSection,
} from "../../agents/query-context/types.js";
import { appendAssemblyAudit } from "../context/assembly-audit.ts";
import { getSharedMemoryPromptJournal } from "../diagnostics/prompt-journal.ts";
import type { DurableRecallResult } from "../durable/read.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { SkillRoutingResult, UnifiedQueryClassification } from "../types/orchestration.ts";
import type { SessionCompactionStateRow } from "../types/runtime.ts";
import type { RuntimeLogger } from "./context-memory-runtime-deps.ts";
import type { DurableRecallSource } from "./context-memory-runtime-helpers.ts";
import type { MemoryRuntimeContext } from "./types.ts";

type ContextArchiveTurnCaptureLike = {
  captureModelVisibleContext(input: {
    sessionId: string;
    sessionKey?: string;
    agentId?: string;
    turnIndex?: number;
    payload: unknown;
  }): Promise<string | null>;
};

export async function runPostAssemblySideEffects(params: {
  runtimeStore: RuntimeStore;
  logger: RuntimeLogger;
  contextArchiveTurnCapture: ContextArchiveTurnCaptureLike;
  sessionId: string;
  sessionKey?: string;
  turnIndex?: number;
  promptText: string;
  model?: string;
  compactedMessages: unknown[];
  promptRecentMessages?: string[];
  rawMessageCount: number;
  compactedMessageCount: number;
  rawMessageTokens: number;
  compactedMessageTokens: number;
  droppedMessageCount: number;
  targetBudget: number;
  built: {
    estimatedTokens: number;
    selectedItemIds: string[];
    sections: Array<{ heading: string }>;
  };
  combined: { text: string; estimatedTokens: number };
  systemContextSections: QueryContextSection[];
  sessionSummaryEstimatedTokens?: number;
  durableSectionEstimatedTokens?: number;
  experienceSectionEstimatedTokens?: number;
  memoryRecallDiagnostics: QueryContextMemoryRecallDiagnostics;
  compactionState?: SessionCompactionStateRow | null;
  rerankedItemCount: number;
  experienceRecallCandidateCount: number;
  durableRecall: DurableRecallResult | null;
  durableRecallSource: DurableRecallSource;
  selectedDurableItemIds: string[];
  omittedDurableItemIds: string[];
  selectedExperienceItemIds: string[];
  omittedExperienceItemIds: string[];
  classification: UnifiedQueryClassification;
  skillRouting: SkillRoutingResult | null;
  runtimeContext?: MemoryRuntimeContext;
}): Promise<void> {
  await appendAssemblyAudit({
    runtimeStore: params.runtimeStore,
    sessionId: params.sessionId,
    prompt: params.promptText,
    rawMessageCount: params.rawMessageCount,
    compactedMessageCount: params.compactedMessageCount,
    rawMessageTokens: params.rawMessageTokens,
    compactedMessageTokens: params.compactedMessageTokens,
    sessionSummaryTokens: params.sessionSummaryEstimatedTokens ?? 0,
    recallTokens: params.built.estimatedTokens - (params.sessionSummaryEstimatedTokens ?? 0),
    systemContextTokens: params.combined.estimatedTokens,
    compactionState: params.compactionState,
    details: {
      droppedMessageCount: params.droppedMessageCount,
      targetBudget: params.targetBudget,
      recallItems: params.rerankedItemCount,
      durableManifestCount: params.durableRecall?.manifest.length ?? 0,
      selectedDurableMemoryIds: params.selectedDurableItemIds,
      omittedDurableMemoryIds: params.omittedDurableItemIds,
      durableSelectionMode: params.durableRecall?.selection.mode ?? null,
      durableRecallSource: params.durableRecallSource,
      durableScope: params.durableRecall?.scope.scopeKey ?? null,
      selectedExperienceRecallIds: params.selectedExperienceItemIds,
      omittedPromptFacingExperienceRecallIds: params.omittedExperienceItemIds,
      selectedItemIds: params.built.selectedItemIds,
      sections: params.built.sections.map((section) => section.heading),
      memorySections: {
        sessionSummary: params.sessionSummaryEstimatedTokens ?? 0,
        durable: params.durableSectionEstimatedTokens ?? 0,
        experience: params.experienceSectionEstimatedTokens ?? 0,
      },
      memoryRecallDiagnostics: params.memoryRecallDiagnostics,
      skillRouting: {
        family: params.skillRouting?.family ?? null,
        primarySkills: params.skillRouting?.primarySkills ?? [],
        supportingSkills: params.skillRouting?.supportingSkills ?? [],
        surfacedSkills: params.skillRouting?.surfacedSkills ?? [],
      },
      contextRouting: {
        targetLayers: params.classification.targetLayers,
        confidence: params.classification.confidence,
      },
      experienceRecallCandidateCount: params.experienceRecallCandidateCount,
    },
  });

  params.logger.info(
    `[memory] prompt assembly tokens=${params.combined.estimatedTokens}/${params.targetBudget} sessionSummary=${params.sessionSummaryEstimatedTokens ?? 0} durable=${params.durableSectionEstimatedTokens ?? 0} experience=${params.experienceSectionEstimatedTokens ?? 0} recallCandidates=${params.experienceRecallCandidateCount} durableManifest=${params.durableRecall?.manifest.length ?? 0} durableSource=${params.durableRecallSource} selected=${params.built.selectedItemIds.length}`,
  );

  getSharedMemoryPromptJournal()?.recordStage("prompt_assembly", {
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId:
      typeof params.runtimeContext?.agentId === "string"
        ? params.runtimeContext.agentId
        : undefined,
    channel:
      typeof params.runtimeContext?.messageChannel === "string"
        ? params.runtimeContext.messageChannel
        : undefined,
    userId:
      typeof params.runtimeContext?.senderId === "string"
        ? params.runtimeContext.senderId
        : undefined,
    payload: {
      prompt: params.promptText,
      recentMessages: params.promptRecentMessages ?? [],
      systemContextSections: params.systemContextSections,
      systemContextText: params.combined.text,
      estimatedTokens: params.combined.estimatedTokens,
      targetBudget: params.targetBudget,
      rawMessageCount: params.rawMessageCount,
      compactedMessageCount: params.compactedMessageCount,
      rawMessageTokens: params.rawMessageTokens,
      compactedMessageTokens: params.compactedMessageTokens,
      memorySections: {
        sessionSummary: params.sessionSummaryEstimatedTokens ?? 0,
        durable: params.durableSectionEstimatedTokens ?? 0,
        experience: params.experienceSectionEstimatedTokens ?? 0,
      },
      memoryRecallDiagnostics: params.memoryRecallDiagnostics,
      durableManifestCount: params.durableRecall?.manifest.length ?? 0,
      durableRecallSource: params.durableRecallSource,
      selectedDurableMemoryIds: params.selectedDurableItemIds,
      omittedDurableMemoryIds: params.omittedDurableItemIds,
      selectedExperienceRecallIds: params.selectedExperienceItemIds,
      omittedExperienceRecallIds: params.omittedExperienceItemIds,
      selectedItemIds: params.built.selectedItemIds,
      contextRouting: {
        targetLayers: params.classification.targetLayers,
        confidence: params.classification.confidence,
      },
      skillRouting: {
        family: params.skillRouting?.family ?? null,
        primarySkills: params.skillRouting?.primarySkills ?? [],
        supportingSkills: params.skillRouting?.supportingSkills ?? [],
        surfacedSkills: params.skillRouting?.surfacedSkills ?? [],
      },
    },
  });

  await params.contextArchiveTurnCapture
    .captureModelVisibleContext({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      agentId:
        typeof params.runtimeContext?.agentId === "string"
          ? params.runtimeContext.agentId
          : undefined,
      turnIndex: params.turnIndex,
      payload: {
        model: params.model ?? null,
        prompt: params.promptText,
        recentMessages: params.promptRecentMessages ?? [],
        messages: params.compactedMessages,
        systemContextSections: params.systemContextSections,
        systemContextText: params.combined.text,
        estimatedTokens: params.combined.estimatedTokens,
        targetBudget: params.targetBudget,
        rawMessageCount: params.rawMessageCount,
        compactedMessageCount: params.compactedMessageCount,
        rawMessageTokens: params.rawMessageTokens,
        compactedMessageTokens: params.compactedMessageTokens,
        droppedMessageCount: params.droppedMessageCount,
        durableRecallSource: params.durableRecallSource,
        selectedDurableMemoryIds: params.selectedDurableItemIds,
        omittedDurableMemoryIds: params.omittedDurableItemIds,
        selectedExperienceRecallIds: params.selectedExperienceItemIds,
        omittedExperienceRecallIds: params.omittedExperienceItemIds,
        selectedItemIds: params.built.selectedItemIds,
        contextRouting: {
          targetLayers: params.classification.targetLayers,
          confidence: params.classification.confidence,
        },
        skillRouting: {
          family: params.skillRouting?.family ?? null,
          primarySkills: params.skillRouting?.primarySkills ?? [],
          supportingSkills: params.skillRouting?.supportingSkills ?? [],
          surfacedSkills: params.skillRouting?.surfacedSkills ?? [],
        },
      },
    })
    .catch((error) => {
      params.logger.warn(
        `[memory] context archive capture skipped | ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}
