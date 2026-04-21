import type { ExperienceRecallResult } from "../experience/provider.ts";
import {
  selectExperienceRecall,
  type ExperienceRecallSelectionResult,
} from "../orchestration/experience-recall-selector.ts";
import { selectRelevantSkills } from "../skills/skill-router.ts";
import type {
  SkillIndex,
  SkillRoutingResult,
  UnifiedQueryClassification,
  UnifiedRecallItem,
  UnifiedRerankResult,
} from "../types/orchestration.ts";
import type { MemoryRuntimeContext } from "./types.ts";

type QueryClassifierLike = {
  classify(params: { query: string; recentMessages?: string[] }): UnifiedQueryClassification;
};

type UnifiedRerankerLike = {
  rerank(params: {
    query: string;
    classification: UnifiedQueryClassification;
    notebooklmItems: UnifiedRecallItem[];
    limit?: number;
  }): UnifiedRerankResult;
};

type SkillIndexStoreLike = {
  getIndex(): SkillIndex;
};

export async function prepareMemoryAssemblyContext(params: {
  promptText: string;
  recentMessages?: string[];
  runtimeContext?: MemoryRuntimeContext;
  queryClassifier: QueryClassifierLike;
  reranker: UnifiedRerankerLike;
  skillIndexStore: SkillIndexStoreLike;
  skillRoutingEnabled: boolean;
  skillRoutingLimit?: number;
  recallExperience(args: {
    prompt: string;
    classification: UnifiedQueryClassification;
    recentMessages?: string[];
    runtimeContext?: MemoryRuntimeContext;
  }): Promise<ExperienceRecallResult>;
}): Promise<{
  classification: UnifiedQueryClassification;
  experienceRecallItems: UnifiedRecallItem[];
  experienceRecall: ExperienceRecallResult;
  reranked: UnifiedRerankResult;
  skillRouting: SkillRoutingResult | null;
  selectedExperience: ExperienceRecallSelectionResult;
}> {
  const classification = params.queryClassifier.classify({
    query: params.promptText,
    recentMessages: params.recentMessages,
  });
  const experienceRecall = await params.recallExperience({
    prompt: params.promptText,
    classification,
    recentMessages: params.recentMessages,
    runtimeContext: params.runtimeContext,
  });
  const experienceRecallItems = experienceRecall.items;
  const reranked = params.reranker.rerank({
    query: params.promptText,
    classification,
    notebooklmItems: experienceRecallItems,
    limit: 10,
  });
  const skillRouting = params.skillRoutingEnabled
    ? selectRelevantSkills({
        classification,
        skillIndex: params.skillIndexStore.getIndex(),
        limit: params.skillRoutingLimit,
      })
    : null;
  const selectedExperience = selectExperienceRecall({ items: reranked.items, limit: 6 });

  return {
    classification,
    experienceRecallItems,
    experienceRecall,
    reranked,
    skillRouting,
    selectedExperience,
  };
}
