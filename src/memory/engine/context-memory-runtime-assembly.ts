import type {
  QueryContextMemoryRecallDiagnostics,
  QueryContextSection,
} from "../../agents/query-context/types.js";
import { resolveMemoryRecallDecisionCodes } from "../../shared/decision-codes.js";
import { joinPromptSections } from "../context/assembly.ts";
import { renderContextRoutingSection } from "../context/render-routing-guidance.ts";
import type { DurableRecallResult } from "../durable/read.ts";
import type { ExperienceQueryPlan } from "../experience/query-plan.ts";
import type { ExperienceRecallSelectionResult } from "../orchestration/experience-recall-selector.ts";
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

function experienceSelectionMetadata(item: ExperienceRecallSelectionResult["items"][number]): {
  providerOrder?: number;
  selectionReason?: string;
} {
  const providerOrder = item.metadata?.providerOrder;
  const selectionReason = item.metadata?.experienceRecallSelection;
  return {
    ...(typeof providerOrder === "number" && Number.isFinite(providerOrder)
      ? { providerOrder }
      : {}),
    ...(typeof selectionReason === "string" && selectionReason.trim() ? { selectionReason } : {}),
  };
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
        durableRecallSource: "sync",
      },
    },
  };
}

export function buildMemoryAssemblyArtifacts(params: {
  built: MemoryPromptAssemblyResult;
  classification: UnifiedQueryClassification;
  agentMemoryRoutingContract: { text: string; estimatedTokens: number };
  selectedExperience: ExperienceRecallSelectionResult;
  experienceQueryPlan?: ExperienceQueryPlan;
  durableRecall: DurableRecallResult | null;
  durableRecallSource: DurableRecallSource;
}): {
  combined: { text: string; estimatedTokens: number };
  systemContextSections: QueryContextSection[];
  durableSection?: MemoryPromptSection;
  experienceSection?: MemoryPromptSection;
  selectedDurableItemIds: string[];
  omittedDurableItemIds: string[];
  selectedExperienceItemIds: string[];
  omittedExperienceItemIds: string[];
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
  const experienceSection = getAssemblySection(params.built.sections, "experience");

  const selectedDurableItemIds = params.durableRecall?.selection.selectedItemIds ?? [];
  const omittedDurableItemIds = params.durableRecall?.selection.omittedItemIds ?? [];
  const selectedExperienceItemIds = params.selectedExperience.selectedItemIds;
  const omittedExperienceItemIds = params.selectedExperience.omittedItemIds;
  const selectedExperienceDetails = params.selectedExperience.items.map((item) => ({
    itemId: item.id,
    title: item.title,
    source: item.source,
    ...(item.memoryKind ? { memoryKind: item.memoryKind } : {}),
    ...experienceSelectionMetadata(item),
  }));
  const omittedExperienceDetails = params.selectedExperience.omittedItems.map((item) => ({
    itemId: item.id,
    title: item.title,
    source: item.source,
    ...(item.memoryKind ? { memoryKind: item.memoryKind } : {}),
    omittedReason: "provider_order_limit",
    ...experienceSelectionMetadata(item),
  }));

  const hitReason = resolveMemoryRecallHitReason({
    selectedDurableCount: selectedDurableItemIds.length,
    selectedExperienceCount: selectedExperienceItemIds.length,
    selectedTotalCount: params.built.selectedItemIds.length,
    durableRecallSource: params.durableRecallSource,
  });
  const evictionReason = resolveMemoryRecallEvictionReason({
    omittedDurableCount: omittedDurableItemIds.length,
    omittedExperienceCount: omittedExperienceItemIds.length,
  });

  const memoryRecallDiagnostics: QueryContextMemoryRecallDiagnostics = {
    selectedItemIds: params.built.selectedItemIds,
    omittedItemIds: [...omittedDurableItemIds, ...omittedExperienceItemIds],
    selectedDurableItemIds,
    omittedDurableItemIds,
    selectedDurableDetails: params.durableRecall?.selection.selectedDetails ?? [],
    omittedDurableDetails: params.durableRecall?.selection.omittedDetails ?? [],
    selectedExperienceItemIds,
    omittedExperienceItemIds,
    selectedExperienceDetails,
    omittedExperienceDetails,
    ...(params.experienceQueryPlan
      ? {
          experienceQueryPlan: {
            enabled: params.experienceQueryPlan.enabled,
            query: params.experienceQueryPlan.query,
            limit: params.experienceQueryPlan.limit,
            targetLayers: params.experienceQueryPlan.targetLayers,
            reason: params.experienceQueryPlan.reason,
            providerIds: params.experienceQueryPlan.providerIds,
          },
        }
      : {}),
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
    experienceSection,
    selectedDurableItemIds,
    omittedDurableItemIds,
    selectedExperienceItemIds,
    omittedExperienceItemIds,
    memoryRecallDiagnostics,
  };
}
