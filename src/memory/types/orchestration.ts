import type { QueryContextSection } from "../../agents/query-context/types.js";
import type { MemoryKind } from "../recall/memory-kind.ts";

export type UnifiedRecallSource = "graph" | "notebooklm" | "native_memory" | "execution";

export type UnifiedRecallIntent =
  | "decision"
  | "sop"
  | "preference"
  | "runtime"
  | "history"
  | "entity_lookup"
  | "broad";

export type UnifiedRecallLayer =
  | "key_decisions"
  | "sop"
  | "preferences"
  | "runtime_signals"
  | "sources";
export type DurableMemoryType = "user" | "feedback" | "project" | "reference";

export type UnifiedSkillFamily =
  | "architecture"
  | "operations"
  | "workspace-defaults"
  | "incident"
  | "multimodal"
  | "other";

export interface UnifiedQueryRouteWeights {
  graph: number;
  notebooklm: number;
  nativeMemory: number;
  execution: number;
}

export interface UnifiedQueryClassification {
  query: string;
  normalizedQuery: string;
  intent: UnifiedRecallIntent;
  secondaryIntents: UnifiedRecallIntent[];
  confidence: number;
  keywords: string[];
  entityHints: string[];
  temporalHints: string[];
  routeWeights: UnifiedQueryRouteWeights;
  targetLayers: UnifiedRecallLayer[];
  skillFamily?: UnifiedSkillFamily;
  rationale: string[];
}

export interface UnifiedQueryClassificationInput {
  query: string;
  recentMessages?: string[];
}

export interface UnifiedEntityCandidate {
  id: string;
  source: UnifiedRecallSource;
  title: string;
  aliases?: string[];
  entityType?: string;
  summary?: string;
  content?: string;
  path?: string;
  canonicalId?: string;
  updatedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface UnifiedEntityRegistry {
  source: UnifiedRecallSource;
  items: UnifiedEntityCandidate[];
}

export type UnifiedEntityMatchType =
  | "title_exact"
  | "alias_exact"
  | "title_contains"
  | "alias_contains"
  | "token_overlap";

export interface UnifiedEntityMatch {
  candidate: UnifiedEntityCandidate;
  score: number;
  matchType: UnifiedEntityMatchType;
}

export interface UnifiedResolvedEntity {
  mention: string;
  matches: UnifiedEntityMatch[];
  selected?: UnifiedEntityMatch;
}

export interface UnifiedEntityResolutionResult {
  mentions: string[];
  resolved: UnifiedResolvedEntity[];
  selectedCandidates: UnifiedEntityCandidate[];
  unresolvedMentions: string[];
}

export interface UnifiedRecallItem {
  id: string;
  source: UnifiedRecallSource;
  title: string;
  summary: string;
  content?: string;
  layer?: UnifiedRecallLayer;
  memoryKind?: MemoryKind;
  durableMemoryType?: DurableMemoryType;
  retrievalScore?: number;
  importance?: number;
  updatedAt?: number;
  entityRefs?: string[];
  canonicalKey?: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}

export interface UnifiedNativeMemoryDocument {
  id: string;
  title: string;
  summary: string;
  content?: string;
  aliases?: string[];
  keywords?: string[];
  layer?: UnifiedRecallLayer;
  memoryKind?: MemoryKind;
  durableMemoryType?: DurableMemoryType;
  importance?: number;
  updatedAt?: number;
  entityRefs?: string[];
  canonicalKey?: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}

export interface UnifiedNativeMemoryQueryInput {
  query: string;
  classification?: UnifiedQueryClassification;
  entityResolution?: UnifiedEntityResolutionResult;
  limit?: number;
}

export interface UnifiedNativeMemoryTrace {
  adapter: string;
  mode: "noop" | "static";
  hitCount: number;
  candidateCount: number;
  reason?: string;
}

export interface UnifiedNativeMemoryResult {
  items: UnifiedRecallItem[];
  trace: UnifiedNativeMemoryTrace;
}

export interface UnifiedNativeMemoryAdapter {
  readonly kind: string;
  recall(input: UnifiedNativeMemoryQueryInput): Promise<UnifiedNativeMemoryResult>;
}

export interface UnifiedTraceEntitySummary {
  id: string;
  source: UnifiedRecallSource;
  title: string;
  canonicalId?: string;
}

export interface UnifiedTraceSectionSummary {
  layer: MemoryPromptSectionKind;
  heading: string;
  itemIds: string[];
  itemCount: number;
  omittedCount: number;
}

export interface UnifiedRecallTraceEnrichment {
  queryType: string;
  entities: UnifiedTraceEntitySummary[];
  graphHits: number;
  notebooklmHits: number;
  nativeMemoryHits: number;
  assembledSections: UnifiedTraceSectionSummary[];
  nativeMemory?: UnifiedNativeMemoryTrace;
}

export interface UnifiedRerankScoreBreakdown {
  retrieval: number;
  sourcePrior: number;
  layerPrior: number;
  memoryKindPrior: number;
  entityBoost: number;
  keywordBoost: number;
  exactTitleBoost: number;
  recencyBoost: number;
  importanceBoost: number;
  supportBoost: number;
  lifecycleBoost: number;
  mediaBoost: number;
  penalty: number;
  finalScore: number;
}

export interface UnifiedRankedItem extends UnifiedRecallItem {
  score: number;
  supportingSources: UnifiedRecallSource[];
  supportingIds: string[];
  scoreBreakdown: UnifiedRerankScoreBreakdown;
}

export type DurableMemoryKind = "user" | "feedback" | "project" | "reference";

export interface DurableMemoryItem extends UnifiedRankedItem {
  durableKind: DurableMemoryKind;
  durableReasons: string[];
}

export type MemoryPromptSectionKind = "durable" | "knowledge";

export interface MemoryPromptSection {
  kind: MemoryPromptSectionKind;
  heading: string;
  lines: string[];
  estimatedTokens: number;
  itemIds: string[];
  omittedCount: number;
}

export interface MemoryPromptAssemblyInput {
  durableItems?: DurableMemoryItem[];
  knowledgeItems?: UnifiedRankedItem[];
  tokenBudget?: number;
}

export interface MemoryPromptAssemblyResult {
  text: string;
  estimatedTokens: number;
  selectedItemIds: string[];
  sections: MemoryPromptSection[];
  queryContextSections?: QueryContextSection[];
  omittedItemIds: string[];
}

export interface UnifiedRerankInput {
  query: string;
  queryHasImage?: boolean;
  classification?: UnifiedQueryClassification;
  entityResolution?: UnifiedEntityResolutionResult;
  graphItems?: UnifiedRecallItem[];
  notebooklmItems?: UnifiedRecallItem[];
  nativeItems?: UnifiedRecallItem[];
  executionItems?: UnifiedRecallItem[];
  limit?: number;
}

export interface UnifiedRerankResult {
  items: UnifiedRankedItem[];
  trace: {
    counts: Record<UnifiedRecallSource, number>;
    deduped: number;
  };
}

export type UnifiedContextSection = MemoryPromptSection;

export interface UnifiedContextAssemblyInput {
  durableItems?: DurableMemoryItem[];
  knowledgeItems?: UnifiedRankedItem[];
  tokenBudget?: number;
}

export type UnifiedContextAssemblyResult = MemoryPromptAssemblyResult;

export interface UnifiedRecallTraceEnrichmentInput {
  classification?: UnifiedQueryClassification;
  entityResolution?: UnifiedEntityResolutionResult;
  rerankTrace?: UnifiedRerankResult["trace"];
  graphItems?: UnifiedRecallItem[];
  notebooklmItems?: UnifiedRecallItem[];
  nativeItems?: UnifiedRecallItem[];
  assembled?: UnifiedContextAssemblyResult;
  nativeMemoryResult?: UnifiedNativeMemoryResult;
}

export interface SkillMetadata {
  name: string;
  description: string;
  location: string;
  family?: UnifiedSkillFamily;
  intents?: UnifiedRecallIntent[];
  layers?: UnifiedRecallLayer[];
  tags?: string[];
  workspaceScope?: string[];
  priority?: number;
  disableModelInvocation?: boolean;
}

export interface SkillIndex {
  skills: SkillMetadata[];
  byName: Map<string, SkillMetadata>;
  refreshedAt: number;
}

export interface SkillRoutingCandidate {
  name: string;
  location: string;
  score: number;
  reasons: string[];
}

export interface SkillRoutingResult {
  intent: UnifiedRecallIntent;
  family?: UnifiedSkillFamily;
  shortlisted: SkillRoutingCandidate[];
  primarySkills: string[];
  supportingSkills: string[];
  surfacedSkills: string[];
  confidence: number;
}
