import type { KnowledgeRecallResult } from "../knowledge/provider.ts";
import {
  selectKnowledgeRecall,
  type KnowledgeRecallSelectionResult,
} from "../orchestration/knowledge-recall-selector.ts";
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
  recallKnowledge(args: {
    prompt: string;
    classification: UnifiedQueryClassification;
    recentMessages?: string[];
    runtimeContext?: MemoryRuntimeContext;
  }): Promise<KnowledgeRecallResult>;
}): Promise<{
  classification: UnifiedQueryClassification;
  knowledgeRecallItems: UnifiedRecallItem[];
  knowledgeRecall: KnowledgeRecallResult;
  reranked: UnifiedRerankResult;
  skillRouting: SkillRoutingResult | null;
  selectedKnowledge: KnowledgeRecallSelectionResult;
}> {
  const classification = params.queryClassifier.classify({
    query: params.promptText,
    recentMessages: params.recentMessages,
  });
  const knowledgeRecall = await params.recallKnowledge({
    prompt: params.promptText,
    classification,
    recentMessages: params.recentMessages,
    runtimeContext: params.runtimeContext,
  });
  const knowledgeRecallItems = knowledgeRecall.items;
  const reranked = params.reranker.rerank({
    query: params.promptText,
    classification,
    notebooklmItems: knowledgeRecallItems,
    limit: 10,
  });
  const skillRouting = params.skillRoutingEnabled
    ? selectRelevantSkills({
        classification,
        skillIndex: params.skillIndexStore.getIndex(),
        limit: params.skillRoutingLimit,
      })
    : null;
  const selectedKnowledge = selectKnowledgeRecall({ items: reranked.items, limit: 6 });

  return {
    classification,
    knowledgeRecallItems,
    knowledgeRecall,
    reranked,
    skillRouting,
    selectedKnowledge,
  };
}
