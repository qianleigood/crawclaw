import type { ContextArchiveService } from "../../agents/context-archive/service.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { isSubagentSessionKey } from "../../sessions/session-key-utils.ts";
import { estimateConversationMessageTokens } from "../context/assembly.ts";
import { runSessionMemoryCompaction } from "../context/compaction-runner.ts";
import {
  applyCompactionStateToMessages,
  prependSessionSummaryCompactMessage,
} from "../context/compaction.ts";
import { runTranscriptMaintenance } from "../context/transcript-maintenance.ts";
import type { AutoDreamRunner } from "../dreaming/auto-dream.ts";
import { resolveDurableMemoryScope } from "../durable/scope.ts";
import type { DurableExtractionRunner } from "../durable/worker-manager.ts";
import type { CompleteFn } from "../extraction/llm.ts";
import { callStructuredOutput } from "../llm/structured-output.ts";
import { startNotebookLmHeartbeat } from "../notebooklm/heartbeat.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { SessionSummaryRunner } from "../session-summary/scheduler.ts";
import { buildSkillIndexFromAvailableSkills } from "../skills/skill-metadata.ts";
import { selectRelevantSkills } from "../skills/skill-router.ts";
import type { MemoryRuntimeConfig, LlmConfig } from "../types/config.ts";
import type { UnifiedQueryClassification } from "../types/orchestration.ts";
import {
  buildPromptMissingAssemblyResult,
  buildMemoryAssemblyArtifacts,
} from "./context-memory-runtime-assembly.ts";
import {
  createContextMemoryRuntimeDeps,
  type RuntimeLogger,
} from "./context-memory-runtime-deps.ts";
import {
  buildSkillDiscoveryCandidates,
  getMessageRole,
  resolvePromptContext,
} from "./context-memory-runtime-helpers.ts";
import { runPostAssemblySideEffects } from "./context-memory-runtime-post-assembly.ts";
import { prepareMemoryAssemblyContext } from "./context-memory-runtime-preparation.ts";
import { resolveDurableRecallForAssembly } from "./context-memory-runtime-recall.ts";
import type { MemoryRuntime, MemoryRuntimeContext } from "./types.ts";

export function createContextMemoryRuntime(options: {
  runtimeStore: RuntimeStore;
  logger: RuntimeLogger;
  config?: MemoryRuntimeConfig;
  llm?: LlmConfig;
  complete?: CompleteFn;
  durableExtractionRunner?: DurableExtractionRunner;
  dreamRunner?: AutoDreamRunner;
  sessionSummaryRunner?: SessionSummaryRunner;
  contextArchive?: Pick<ContextArchiveService, "createRun" | "appendEvent">;
}): MemoryRuntime & {
  resolveRelevantSkills(event: {
    prompt?: string;
    customInstructions?: string;
    messages?: Array<{ content?: unknown }>;
    availableSkills?: Array<{ name: string; description?: string; location: string }>;
  }): Promise<string[]>;
  resolveDiscoveredSkills(event: {
    prompt?: string;
    customInstructions?: string;
    availableSkills?: Array<{ name: string; description?: string; location: string }>;
    skillExposureState?: {
      surfacedSkillNames?: string[];
      loadedSkillNames?: string[];
      discoverBudgetRemaining?: number;
    };
  }): Promise<{ discoveredSkillNames: string[]; reason?: string; confidence?: number }>;
} {
  const turnIndex = new Map<string, number>();
  const {
    structuredComplete,
    ingestCoordinator,
    queryClassifier,
    reranker,
    contextAssembler,
    experienceProviderRegistry,
    skillIndexStore,
    agentMemoryRoutingContract,
    contextArchiveTurnCapture,
  } = createContextMemoryRuntimeDeps(options);

  async function recallExperience(params: {
    prompt: string;
    classification: UnifiedQueryClassification;
    recentMessages?: string[];
    runtimeContext?: MemoryRuntimeContext;
  }) {
    return await experienceProviderRegistry.search({
      query: params.prompt,
      classification: params.classification,
      recentMessages: params.recentMessages,
      runtimeContext: params.runtimeContext,
    });
  }

  return {
    info: {
      id: "builtin-memory",
      name: "CrawClaw Memory",
      ownsCompaction: true,
    },

    async bootstrap({ sessionId }) {
      if (!turnIndex.has(sessionId)) {
        turnIndex.set(sessionId, 0);
      }
      startNotebookLmHeartbeat({
        config: options.config?.notebooklm,
        logger: options.logger,
      });
      return { bootstrapped: true };
    },

    async ingest({ sessionId, message, isHeartbeat }) {
      if (isHeartbeat) {
        return { ingested: false };
      }
      const idx = (turnIndex.get(sessionId) ?? 0) + 1;
      turnIndex.set(sessionId, idx);
      await ingestCoordinator.ingestMessage({
        sessionId,
        conversationUid: sessionId,
        role: getMessageRole(message),
        message,
        turnIndex: idx,
        sourceType: "message_turn",
      });
      return { ingested: true };
    },

    async assemble({
      sessionId,
      sessionKey,
      messages,
      tokenBudget,
      prompt,
      model,
      runtimeContext,
    }) {
      const compactionState = await options.runtimeStore.getSessionCompactionState(sessionId);
      const compactedTailMessages = applyCompactionStateToMessages({
        messages,
        preservedTailStartTurn: compactionState?.preservedTailStartTurn,
        preservedTailMessageId: compactionState?.preservedTailMessageId,
      });
      const compactedMessages = prependSessionSummaryCompactMessage({
        sessionId,
        messages: compactedTailMessages,
        summaryText: compactionState?.summaryOverrideText,
        summarizedThroughMessageId: compactionState?.summarizedThroughMessageId,
        preservedTailMessageId: compactionState?.preservedTailMessageId,
        preservedTailStartTurn: compactionState?.preservedTailStartTurn,
        updatedAt: compactionState?.updatedAt,
      });
      const rawMessageCount = messages.length;
      const compactedMessageCount = compactedMessages.length;
      const rawMessageTokens = estimateConversationMessageTokens(messages);
      const compactedMessageTokens = estimateConversationMessageTokens(compactedMessages);
      const droppedMessageCount = Math.max(0, messages.length - compactedMessages.length);
      const targetBudget = Math.max(240, Math.min(tokenBudget ?? 1000, 1200));
      const promptContext = resolvePromptContext({ prompt, messages: compactedMessages });
      const promptText = promptContext.prompt;

      if (!promptText) {
        const built = contextAssembler.assemble({
          durableItems: [],
          experienceItems: [],
          tokenBudget: targetBudget,
        });
        const promptMissingResult = buildPromptMissingAssemblyResult({
          built,
          messages: compactedMessages,
        });
        await contextArchiveTurnCapture
          .captureModelVisibleContext({
            sessionId,
            sessionKey,
            agentId:
              typeof runtimeContext?.agentId === "string" ? runtimeContext.agentId : undefined,
            turnIndex: turnIndex.get(sessionId) ?? undefined,
            payload: {
              model: model ?? null,
              prompt: null,
              messages: compactedMessages,
              systemContextSections: promptMissingResult.systemContextSections,
              systemContextText: built.text || null,
              estimatedTokens: built.estimatedTokens,
              targetBudget,
              rawMessageCount,
              compactedMessageCount,
              rawMessageTokens,
              compactedMessageTokens,
              droppedMessageCount,
              selectedDurableMemoryIds: [],
              selectedExperienceRecallIds: [],
              selectedItemIds: [],
            },
          })
          .catch((error) => {
            options.logger.warn(
              `[memory] context archive capture skipped | ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        return promptMissingResult;
      }

      const {
        classification,
        experienceRecall,
        experienceRecallItems,
        reranked,
        skillRouting,
        selectedExperience,
      } = await prepareMemoryAssemblyContext({
        promptText,
        recentMessages: promptContext.recentMessages,
        runtimeContext,
        queryClassifier,
        reranker,
        skillIndexStore,
        skillRoutingEnabled: options.config?.skillRouting.enabled !== false,
        skillRoutingLimit: options.config?.skillRouting.shortlistLimit,
        recallExperience,
      });
      const { durableRecall, durableRecallSource } = await resolveDurableRecallForAssembly({
        sessionId,
        sessionKey,
        promptText,
        recentMessages: promptContext.recentMessages,
        runtimeContext,
        runtimeStore: options.runtimeStore,
        logger: options.logger,
        complete: structuredComplete,
      });
      const built = contextAssembler.assemble({
        durableItems: durableRecall?.items ?? [],
        experienceItems: selectedExperience.items,
        classification,
        tokenBudget: targetBudget,
      });
      const {
        combined,
        systemContextSections,
        durableSection,
        experienceSection,
        selectedDurableItemIds,
        omittedDurableItemIds,
        selectedExperienceItemIds,
        omittedExperienceItemIds,
        memoryRecallDiagnostics,
      } = buildMemoryAssemblyArtifacts({
        built,
        classification,
        agentMemoryRoutingContract,
        selectedExperience,
        experienceQueryPlan: experienceRecall.queryPlan,
        durableRecall,
        durableRecallSource,
      });
      await runPostAssemblySideEffects({
        runtimeStore: options.runtimeStore,
        logger: options.logger,
        contextArchiveTurnCapture,
        sessionId,
        sessionKey,
        turnIndex: turnIndex.get(sessionId) ?? undefined,
        promptText,
        model,
        compactedMessages,
        promptRecentMessages: promptContext.recentMessages,
        rawMessageCount,
        compactedMessageCount,
        rawMessageTokens,
        compactedMessageTokens,
        droppedMessageCount,
        targetBudget,
        built,
        combined,
        systemContextSections,
        durableSectionEstimatedTokens: durableSection?.estimatedTokens,
        experienceSectionEstimatedTokens: experienceSection?.estimatedTokens,
        memoryRecallDiagnostics,
        compactionState,
        rerankedItemCount: reranked.items.length,
        experienceRecallCandidateCount: experienceRecallItems.length,
        durableRecall,
        durableRecallSource,
        selectedDurableItemIds,
        omittedDurableItemIds,
        selectedExperienceItemIds,
        omittedExperienceItemIds,
        classification,
        skillRouting,
        runtimeContext,
      });
      return {
        messages: compactedMessages,
        estimatedTokens: combined.estimatedTokens,
        systemContextSections,
        diagnostics: {
          memoryRecall: memoryRecallDiagnostics,
        },
      };
    },

    async afterTurn({ sessionId, sessionKey, messages, prePromptMessageCount, runtimeContext }) {
      const hasLiveMessages = Array.isArray(messages);
      const messageList = hasLiveMessages ? messages : [];
      const resolvedPrePromptCount =
        typeof prePromptMessageCount === "number" && Number.isFinite(prePromptMessageCount)
          ? prePromptMessageCount
          : (turnIndex.get(sessionId) ?? messageList.length);
      const newMessages = hasLiveMessages ? messageList.slice(resolvedPrePromptCount) : [];
      const count = hasLiveMessages
        ? resolvedPrePromptCount + newMessages.length
        : resolvedPrePromptCount;
      if (count < 1 || !newMessages.length) {
        return;
      }

      await Promise.all(
        newMessages.map((msg, index) =>
          ingestCoordinator.ingestMessage({
            sessionId,
            conversationUid: sessionId,
            role: getMessageRole(msg),
            message: msg,
            turnIndex: resolvedPrePromptCount + index + 1,
            createdAt: Date.now(),
            sourceType: "after_turn_live_message",
          }),
        ),
      );

      const resolvedSessionKey = typeof sessionKey === "string" ? sessionKey.trim() : "";
      if (resolvedSessionKey && !isSubagentSessionKey(resolvedSessionKey)) {
        const durableScope = resolveDurableMemoryScope({
          sessionKey: resolvedSessionKey,
          agentId: typeof runtimeContext?.agentId === "string" ? runtimeContext.agentId : undefined,
          channel:
            typeof runtimeContext?.messageChannel === "string"
              ? runtimeContext.messageChannel
              : undefined,
          userId:
            typeof runtimeContext?.senderId === "string" ? runtimeContext.senderId : undefined,
        });
        if (durableScope?.scopeKey) {
          await options.runtimeStore.upsertSessionScope({
            sessionId,
            sessionKey: resolvedSessionKey,
            scopeKey: durableScope.scopeKey,
            agentId: durableScope.agentId,
            channel: durableScope.channel,
            userId: durableScope.userId,
          });
        }
      }
    },

    async compact({ sessionId, tokenBudget, currentTokenCount, force, runtimeContext }) {
      const compactAgentId =
        (typeof runtimeContext?.agentId === "string" && runtimeContext.agentId.trim()) ||
        resolveAgentIdFromSessionKey(
          typeof runtimeContext?.sessionKey === "string" ? runtimeContext.sessionKey : undefined,
        ) ||
        "main";
      const totalTurns = Math.max(turnIndex.get(sessionId) ?? 0, 0);
      const result = await runSessionMemoryCompaction({
        runtimeStore: options.runtimeStore,
        logger: options.logger,
        sessionId,
        agentId: compactAgentId,
        totalTurns,
        tokenBudget,
        currentTokenCount,
        force,
        runtimeContext,
        maxSummaryWaitMs: options.config?.sessionSummary?.maxWaitMs ?? 15_000,
      });
      await contextArchiveTurnCapture
        .appendEvent({
          sessionId,
          sessionKey:
            typeof runtimeContext?.sessionKey === "string" ? runtimeContext.sessionKey : undefined,
          agentId: typeof runtimeContext?.agentId === "string" ? runtimeContext.agentId : undefined,
          turnIndex: totalTurns,
          type: "turn.compaction",
          payload: {
            sessionId,
            compacted: result.compacted,
            reason: result.reason,
            ...(result.compacted ? { result: result.result } : {}),
            tokenBudget: tokenBudget ?? null,
            currentTokenCount: currentTokenCount ?? null,
            force: Boolean(force),
            trigger: typeof runtimeContext?.trigger === "string" ? runtimeContext.trigger : null,
          },
          metadata: {
            source: "context-memory-runtime.compact",
          },
        })
        .catch((error) => {
          options.logger.warn(
            `[memory] context archive compaction capture skipped | ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      return result;
    },

    async maintain({ sessionId, sessionFile, runtimeContext }) {
      const result = await runTranscriptMaintenance({
        runtimeStore: options.runtimeStore,
        logger: options.logger,
        sessionId,
        sessionFile,
        trigger: typeof runtimeContext?.trigger === "string" ? runtimeContext.trigger : null,
        rewriteTranscriptEntries: runtimeContext?.rewriteTranscriptEntries,
      });
      await contextArchiveTurnCapture
        .appendEvent({
          sessionId,
          sessionKey:
            typeof runtimeContext?.sessionKey === "string" ? runtimeContext.sessionKey : undefined,
          agentId: typeof runtimeContext?.agentId === "string" ? runtimeContext.agentId : undefined,
          type: "turn.transcript_maintenance",
          payload: {
            sessionId,
            ...result,
            trigger: typeof runtimeContext?.trigger === "string" ? runtimeContext.trigger : null,
          },
          metadata: {
            source: "context-memory-runtime.maintain",
          },
        })
        .catch((error) => {
          options.logger.warn(
            `[memory] context archive transcript-maintenance capture skipped | ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      return result;
    },

    async dispose() {
      turnIndex.clear();
      contextArchiveTurnCapture.reset();
    },

    async resolveRelevantSkills(event) {
      if (options.config?.skillRouting.enabled === false) {
        return [];
      }
      const promptContext = resolvePromptContext({
        prompt: typeof event.prompt === "string" ? event.prompt : event.customInstructions,
        messages: event.messages,
      });
      if (!promptContext.prompt) {
        return [];
      }
      const classification = queryClassifier.classify({
        query: promptContext.prompt,
        recentMessages: promptContext.recentMessages,
      });
      const skillIndex = event.availableSkills?.length
        ? buildSkillIndexFromAvailableSkills({
            availableSkills: event.availableSkills,
            logger: options.logger,
          })
        : skillIndexStore.getIndex();
      const skillRouting = selectRelevantSkills({
        classification,
        skillIndex,
        limit: options.config?.skillRouting.shortlistLimit,
      });
      return skillRouting.surfacedSkills;
    },

    async resolveDiscoveredSkills(event) {
      const prompt = typeof event.prompt === "string" ? event.prompt : event.customInstructions;
      const loadedSkillNames = event.skillExposureState?.loadedSkillNames ?? [];
      const surfacedSkillNames = event.skillExposureState?.surfacedSkillNames ?? [];
      const maxDiscover = Math.max(
        0,
        Math.min(2, event.skillExposureState?.discoverBudgetRemaining ?? 0),
      );
      if (!structuredComplete || !prompt?.trim() || !maxDiscover || !loadedSkillNames.length) {
        return { discoveredSkillNames: [] };
      }

      const candidates = buildSkillDiscoveryCandidates({
        prompt,
        loadedSkillNames,
        surfacedSkillNames,
        availableSkills: event.availableSkills ?? [],
      });
      if (!candidates.length) {
        return { discoveredSkillNames: [] };
      }

      const candidateNames = new Set(candidates.map((skill) => skill.name));
      try {
        const structured = await callStructuredOutput(structuredComplete, {
          system: [
            "You select additional supporting skills for the next step of a coding agent workflow.",
            "Only choose from the provided candidate skills.",
            `Return at most ${maxDiscover} skill names.`,
            "Prefer supporting skills that complement already loaded skills for adjacent tasks such as documentation, messaging, reporting, or follow-up execution.",
            "If no additional skill is clearly needed, return an empty list.",
          ].join("\n"),
          user: [
            `Current task:\n${prompt.trim()}`,
            `Already surfaced skills:\n${surfacedSkillNames.join(", ") || "(none)"}`,
            `Already loaded skills:\n${loadedSkillNames.join(", ") || "(none)"}`,
            "Candidate skills:",
            ...candidates.map((skill) => `- ${skill.name}: ${skill.description ?? ""}`.trim()),
          ].join("\n\n"),
          formatHint:
            'Output JSON only with shape {"discoveredSkillNames":["..."],"reason":"...","confidence":0.0}.',
          retries: 1,
          validator: (value: unknown) => {
            if (!value || typeof value !== "object") {
              throw new Error("discover result must be an object");
            }
            const record = value as Record<string, unknown>;
            const discoveredSkillNames = Array.isArray(record.discoveredSkillNames)
              ? record.discoveredSkillNames
                  .filter(
                    (item): item is string => typeof item === "string" && item.trim().length > 0,
                  )
                  .map((item) => item.trim())
                  .filter((item, index, list) => list.indexOf(item) === index)
                  .filter((item) => candidateNames.has(item))
                  .slice(0, maxDiscover)
              : [];
            return {
              discoveredSkillNames,
              reason:
                typeof record.reason === "string" && record.reason.trim()
                  ? record.reason.trim()
                  : undefined,
              confidence:
                typeof record.confidence === "number"
                  ? Number(Math.max(0, Math.min(1, record.confidence)).toFixed(3))
                  : undefined,
            };
          },
          fallback: () => ({ discoveredSkillNames: [] as string[] }),
        });
        return structured.value;
      } catch (error) {
        options.logger.warn(
          `[memory] discover skills failed; continuing without expansion | ${error instanceof Error ? error.message : String(error)}`,
        );
        return { discoveredSkillNames: [] };
      }
    },
  };
}
