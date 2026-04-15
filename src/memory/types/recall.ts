import type { UnifiedRecallTraceEnrichment } from "./orchestration.ts";
import type { ExecutionSubgraphItem, ExecutionTask } from "./execution.ts";
import type { GmEdge, GmNode } from "./graph.ts";

export interface RecallInput {
  query: string;
  queryImage?: string;
  recentMessages?: string[];
  limit?: number;
  depth?: number;
}

export interface RecallSeed {
  node: GmNode;
  score: number;
  sources?: Array<"fulltext" | "vector" | "chunk-evidence">;
  scoreParts?: {
    fulltext?: number;
    vector?: number;
    evidence?: number;
    evidenceCount?: number;
    exact?: number;
    typePrior?: number;
    diversityBonus?: number;
    evidenceCoverageBonus?: number;
    actionBonus?: number;
    narrowBonus?: number;
    lexicalPenalty?: number;
    baseScoreBeforeMetaPenalty?: number;
    metaPenalty?: number;
    configPathBonus?: number;
    configPathPenalty?: number;
    mediaBoost?: number;
    finalScore?: number;
  };
}

export interface RecallEvidenceChunk {
  pointId: string;
  score: number;
  chunkId: string;
  sourceId: string;
  title?: string;
  content: string;
  entityRefs: string[];
  hasImage?: boolean;
  image?: string;
  imageAlt?: string;
  primaryMediaId?: string | null;
  mediaIds?: string[];
  visualSummary?: string | null;
  embeddingMode?: "text" | "image" | "multimodal";
}

export interface ExecutionRecallItem {
  task: ExecutionTask;
  score: number;
}

export type RecallReasonSourceType = "seed" | "evidence_chunk" | "execution_hit" | "graph_node" | "graph_edge" | "fallback";
export type RecallReasonSourceStage = "precise" | "generalized" | "fallback";
export type RecallReasonViaType = "seed" | "chunk" | "execution" | "node" | "edge" | "session" | "community";

export interface RecallReasonLinkRef {
  refType: RecallReasonSourceType;
  refId: string;
  viaType?: RecallReasonViaType;
  viaRefId?: string;
  hopDepth?: number;
  communityId?: string;
  communityHop?: number;
  sourceType: RecallReasonSourceType;
  sourceRef: string;
  sourceStage: RecallReasonSourceStage;
}

export interface RecallReasonPath {
  pathId: string;
  label: string;
  summary: string;
  pathType: "direct" | "graph" | "community" | "chunk" | "execution" | "fallback";
  representative?: boolean;
  linkedReasonRefs: RecallReasonLinkRef[];
}

export interface RecallReason {
  reasonId: string;
  kind: "knowledge_seed" | "supporting_evidence" | "execution_evidence" | "related_context" | "fallback";
  label: string;
  summary: string;
  sourceType: RecallReasonSourceType;
  sourceRef: string;
  sourceStage: RecallReasonSourceStage;
  viaType?: RecallReasonViaType;
  viaRefId?: string;
  linkedReasonRefs?: RecallReasonLinkRef[];
  equivalentPaths?: RecallReasonPath[];
}

export interface RecallEvidenceItem {
  evidenceId: string;
  reasonId: string;
  kind: "seed" | "chunk" | "execution" | "node" | "edge" | "fallback";
  label: string;
  score?: number;
  sourceType: RecallReasonSourceType;
  sourceRef: string;
  sourceStage: RecallReasonSourceStage;
  viaType?: RecallReasonViaType;
  viaRefId?: string;
  preview?: string;
}

export interface RecallTraceSeedItem {
  id: string;
  name: string;
  type: GmNode["type"];
  score: number;
  hasImage?: boolean;
  primaryMediaId?: string | null;
  mediaIds?: string[];
  visualSummary?: string | null;
  sources?: Array<"fulltext" | "vector" | "chunk-evidence">;
  scoreParts?: RecallSeed["scoreParts"];
}

export interface RecallTraceChunkItem {
  chunkId: string;
  title?: string;
  score: number;
  entityRefs: string[];
  sourceId: string;
  hasImage?: boolean;
  primaryMediaId?: string | null;
  mediaIds?: string[];
  visualSummary?: string | null;
  embeddingMode?: "text" | "image" | "multimodal";
}

export interface RecallTraceExecutionItem {
  id: string;
  name: string;
  score: number;
  status?: string;
  kind?: string;
  artifacts?: ExecutionSubgraphItem["artifacts"];
}

export interface RecallValidationEvidenceItem {
  nodeId: string;
  nodeType: GmNode["type"];
  nodeName: string;
  validationStatus: GmNode["validationStatus"];
  lifecycleStage: GmNode["lifecycleStage"];
  validatedCount: number;
  confidenceScore?: number;
  lastValidatedAt?: number | null;
  traceRef: string;
  alignment: "aligned" | "needs_review";
  evidenceRefs: string[];
  rationale: string;
}

export type RecallQueryShape = "keyword" | "mixed" | "narrative";
export type RecallMode = "fts" | "hybrid" | "vector";

export interface RecallQueryAnalysis {
  rawText: string;
  normalizedText: string;
  rawLength: number;
  lineCount: number;
  tokens: string[];
  effectiveTokens: string[];
  expandedTokens: string[];
  tokenCount: number;
  effectiveTokenCount: number;
  expandedTokenCount: number;
  uniqueTokenCount: number;
  avgTokenLength: number;
  hasCodeLikeText: boolean;
  hasStackTraceLikeText: boolean;
  hasPathLikeText: boolean;
  hasErrorLikeText: boolean;
  hasQuotedLogBlock: boolean;
  entityHints: string[];
  extractedComponents: string[];
  extractedExceptions: string[];
  extractedProcedures: string[];
  extractedSymptoms: string[];
  shape: RecallQueryShape;
  estimatedClauseCount: number;
}

export interface RecallTrace {
  query?: string;
  queryHasImage?: boolean;
  queryMediaRef?: string;
  queryEmbeddingMode?: "text" | "image" | "multimodal";
  mode?: RecallMode;
  modeReason?: string;
  intent?: "fix" | "design" | "search" | "explain" | "config" | "unknown";
  executionFirst?: boolean;
  fulltextQuery?: string;
  vectorQueryPreview?: string;
  analysis?: RecallQueryAnalysis;
  fallbacks?: Array<{
    stage: "embed" | "fts" | "vector" | "chunks" | "result";
    from: string;
    to: string;
    reason: string;
    error?: string;
  }>;
  seedCount: number;
  evidenceChunkCount: number;
  nodeCount: number;
  edgeCount: number;
  executionCount?: number;
  rerankWeights?: {
    fulltextWeight: number;
    vectorWeight: number;
    evidenceWeight: number;
    exactWeight: number;
    typePriorWeight: number;
    sourceDiversityBonusTwoSources: number;
    sourceDiversityBonusThreeSources: number;
    evidenceCoverageBonusOneHit: number;
    evidenceCoverageBonusTwoHits: number;
    evidenceCoverageBonusThreeHits: number;
  };
  candidateCounts?: {
    fulltext: number;
    vector: number;
    evidence: number;
    merged: number;
    selectedKnowledge: number;
    selectedExecution: number;
    expandedNodes: number;
    expandedEdges: number;
  };
  fulltextSeeds?: RecallTraceSeedItem[];
  vectorSeeds?: RecallTraceSeedItem[];
  mergedSeeds?: RecallTraceSeedItem[];
  evidenceChunks?: RecallTraceChunkItem[];
  executionHits?: RecallTraceExecutionItem[];
  reasons?: RecallReason[];
  evidenceTrail?: RecallEvidenceItem[];
  validationEvidence?: RecallValidationEvidenceItem[];
  queryType?: UnifiedRecallTraceEnrichment["queryType"];
  entities?: UnifiedRecallTraceEnrichment["entities"];
  graphHits?: UnifiedRecallTraceEnrichment["graphHits"];
  notebooklmHits?: UnifiedRecallTraceEnrichment["notebooklmHits"];
  nativeMemoryHits?: UnifiedRecallTraceEnrichment["nativeMemoryHits"];
  assembledSections?: UnifiedRecallTraceEnrichment["assembledSections"];
  unifiedRecall?: UnifiedRecallTraceEnrichment;
}

export interface RecallResult {
  seeds: RecallSeed[];
  evidenceChunks?: RecallEvidenceChunk[];
  execution?: ExecutionRecallItem[];
  nodes: GmNode[];
  edges: GmEdge[];
  promptAddition: string;
  trace?: RecallTrace;
}
