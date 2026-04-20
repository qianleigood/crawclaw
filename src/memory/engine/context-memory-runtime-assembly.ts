import type {
  QueryContextMemoryRecallDiagnostics,
  QueryContextSection,
} from "../../agents/query-context/types.js";
import { resolveMemoryRecallDecisionCodes } from "../../shared/decision-codes.js";
import { joinPromptSections } from "../context/assembly.ts";
import { renderContextRoutingSection } from "../context/render-routing-guidance.ts";
import type { DurableRecallResult } from "../durable/read.ts";
import type { KnowledgeRecallSelectionResult } from "../orchestration/knowledge-recall-selector.ts";
import type {
  MemoryPromptAssemblyResult,
  MemoryPromptSection,
  UnifiedQueryClassification,
} from "../types/orchestration.ts";
import {
  createMemorySystemContextSection,
  resolveMemoryRecallEvictionReason,
  resolveMemoryRecallHitReason,
  type DurableRecallSource,
} from "./context-memory-runtime-helpers.ts";
import type { MemoryAssembleResult } from "./types.ts";

function getAssemblySection(
  sections: MemoryPromptSection[],
  kind: MemoryPromptSection["kind"],
): MemoryPromptSection | undefined {
  return sections.find((section) => section.kind === kind);
}

export function buildPromptMissingAssemblyResult(params: {
  built: MemoryPromptAssemblyResult;
  messages: MemoryAssembleResult["messages"];
}): MemoryAssembleResult {
  const systemContextSections = params.built.queryContextSections ?? [];
  return {
    messages: params.messages,
    estimatedTokens: params.built.estimatedTokens,
    systemContextSections,
    diagnostics: {
      memoryRecall: {
        selectedItemIds: [],
        omittedItemIds: [],
        hitReason: "prompt_missing",
        durableRecallSource: "prefetch_missing",
      },
    },
  };
}

export function buildMemoryAssemblyArtifacts(params: {
  built: MemoryPromptAssemblyResult;
  classification: UnifiedQueryClassification;
  agentMemoryRoutingContract: { text: string; estimatedTokens: number };
  selectedKnowledge: KnowledgeRecallSelectionResult;
  durableRecall: DurableRecallResult | null;
  durableRecallSource: DurableRecallSource;
}): {
  combined: { text: string; estimatedTokens: number };
  systemContextSections: QueryContextSection[];
  durableSection?: MemoryPromptSection;
  knowledgeSection?: MemoryPromptSection;
  selectedDurableItemIds: string[];
  omittedDurableItemIds: string[];
  selectedKnowledgeItemIds: string[];
  omittedKnowledgeItemIds: string[];
  memoryRecallDiagnostics: QueryContextMemoryRecallDiagnostics;
} {
  const contextRoutingSection = renderContextRoutingSection(params.classification);
  const combined = joinPromptSections([
    params.agentMemoryRoutingContract,
    contextRoutingSection,
    params.built.text
      ? { text: params.built.text, estimatedTokens: params.built.estimatedTokens }
      : null,
  ]);
  const systemContextSections = [
    createMemorySystemContextSection({
      id: "memory:routing_contract",
      text: params.agentMemoryRoutingContract.text,
      estimatedTokens: params.agentMemoryRoutingContract.estimatedTokens,
      sectionType: "routing",
      schema: {
        kind: "routing",
        routingKind: "memory_contract",
      },
      metadata: {
        sectionType: "routing",
      },
    }),
    contextRoutingSection
      ? createMemorySystemContextSection({
          id: "memory:context_routing",
          text: contextRoutingSection.text,
          estimatedTokens: contextRoutingSection.estimatedTokens,
          sectionType: "routing",
          schema: {
            kind: "routing",
            routingKind: "context_routing",
            targetLayers: params.classification.targetLayers,
            confidence: params.classification.confidence,
          },
          metadata: {
            sectionType: "routing",
            targetLayers: params.classification.targetLayers,
            confidence: params.classification.confidence,
          },
        })
      : null,
    ...(params.built.queryContextSections ?? []),
  ].filter((section): section is QueryContextSection => Boolean(section));

  const durableSection = getAssemblySection(params.built.sections, "durable");
  const knowledgeSection = getAssemblySection(params.built.sections, "knowledge");

  const selectedDurableItemIds = params.durableRecall?.selection.selectedItemIds ?? [];
  const omittedDurableItemIds = params.durableRecall?.selection.omittedItemIds ?? [];
  const selectedKnowledgeItemIds = params.selectedKnowledge.selectedItemIds;
  const omittedKnowledgeItemIds = params.selectedKnowledge.omittedItemIds;

  const hitReason = resolveMemoryRecallHitReason({
    selectedDurableCount: selectedDurableItemIds.length,
    selectedKnowledgeCount: selectedKnowledgeItemIds.length,
    selectedTotalCount: params.built.selectedItemIds.length,
    durableRecallSource: params.durableRecallSource,
  });
  const evictionReason = resolveMemoryRecallEvictionReason({
    omittedDurableCount: omittedDurableItemIds.length,
    omittedKnowledgeCount: omittedKnowledgeItemIds.length,
  });

  const memoryRecallDiagnostics: QueryContextMemoryRecallDiagnostics = {
    selectedItemIds: params.built.selectedItemIds,
    omittedItemIds: [...omittedDurableItemIds, ...omittedKnowledgeItemIds],
    selectedDurableItemIds,
    omittedDurableItemIds,
    selectedKnowledgeItemIds,
    omittedKnowledgeItemIds,
    hitReason,
    evictionReason,
    durableRecallSource: params.durableRecallSource,
    decisionCodes: resolveMemoryRecallDecisionCodes({
      hitReason,
      evictionReason,
      durableRecallSource: params.durableRecallSource,
    }),
  };

  return {
    combined,
    systemContextSections,
    durableSection,
    knowledgeSection,
    selectedDurableItemIds,
    omittedDurableItemIds,
    selectedKnowledgeItemIds,
    omittedKnowledgeItemIds,
    memoryRecallDiagnostics,
  };
}
