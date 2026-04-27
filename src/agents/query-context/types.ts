import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import type { ContextWindowSource, ModelContextBudgetConfidence } from "../context-window-guard.js";

export type QueryContextSectionRole = "system_prompt" | "system_context" | "user_context";
export type QueryContextSectionType =
  | "durable_memory"
  | "experience"
  | "routing"
  | "hook"
  | "bootstrap"
  | "skills"
  | "inherited"
  | "other";

export type QueryContextSectionSchema =
  | {
      kind: "durable_memory";
      itemIds: string[];
      omittedCount: number;
    }
  | {
      kind: "experience";
      itemIds: string[];
      omittedCount: number;
    }
  | {
      kind: "routing";
      routingKind?: string;
      targetLayers?: string[];
      confidence?: number;
    }
  | {
      kind: "hook" | "bootstrap" | "skills" | "inherited" | "other";
      detail?: Record<string, unknown>;
    };

export type QueryContextSectionBudget = {
  priority?: "critical" | "high" | "normal" | "low";
  eviction?: "drop" | "truncate";
  maxTokens?: number;
};

export type QueryContextSection = {
  id: string;
  role: QueryContextSectionRole;
  content: string;
  sectionType?: QueryContextSectionType;
  schema?: QueryContextSectionSchema;
  title?: string;
  source?: string;
  cacheable?: boolean;
  metadata?: Record<string, unknown>;
  budget?: QueryContextSectionBudget;
};

export type QueryContextPatch = {
  replaceUserPrompt?: string;
  clearSystemContextSections?: boolean;
  replaceSystemPromptSections?: QueryContextSection[];
  prependUserContextSections?: QueryContextSection[];
  appendUserContextSections?: QueryContextSection[];
  prependSystemContextSections?: QueryContextSection[];
  appendSystemContextSections?: QueryContextSection[];
};

export type QueryContextToolContext = {
  tools: AgentTool[];
  toolNames: string[];
  toolPromptPayload: unknown[];
};

export type QueryContextDiagnostics = {
  bootstrapFiles?: string[];
  skillNames?: string[];
  memorySources?: string[];
  sectionTokenUsage?: QueryContextSectionTokenUsage;
  hookMutations?: QueryContextHookMutationSummary[];
  memoryRecall?: QueryContextMemoryRecallDiagnostics;
  providerRequestSnapshot?: QueryContextProviderRequestSnapshot;
  contextBudget?: QueryContextBudgetDiagnostics;
  queryContextHash?: string;
  decisionCodes?: Record<string, string>;
};

export type QueryContextSectionTokenUsage = {
  totalEstimatedTokens: number;
  byRole: Record<QueryContextSectionRole, number>;
  byType: Record<string, number>;
  byRolePercent?: Record<QueryContextSectionRole, number>;
  byTypePercent?: Record<string, number>;
};

export type QueryContextHookMutationSummary = {
  hook: string;
  prependUserContextSections: number;
  appendUserContextSections: number;
  prependSystemContextSections: number;
  appendSystemContextSections: number;
  replaceSystemPromptSections: number;
  clearSystemContextSections: boolean;
  replaceUserPrompt: boolean;
};

export type QueryContextMemoryRecallDiagnostics = {
  selectedItemIds?: string[];
  omittedItemIds?: string[];
  selectedDurableItemIds?: string[];
  omittedDurableItemIds?: string[];
  selectedDurableDetails?: Array<{
    itemId: string;
    notePath: string;
    title: string;
    provenance: string[];
    scoreBreakdown?: Record<string, number>;
  }>;
  omittedDurableDetails?: Array<{
    itemId: string;
    notePath: string;
    title: string;
    provenance: string[];
    omittedReason?: string;
    scoreBreakdown?: Record<string, number>;
  }>;
  recentDreamTouchedNotes?: string[];
  selectedExperienceItemIds?: string[];
  omittedExperienceItemIds?: string[];
  selectedExperienceDetails?: Array<{
    itemId: string;
    title: string;
    source: string;
    memoryKind?: string;
    scoreBreakdown?: Record<string, number>;
  }>;
  omittedExperienceDetails?: Array<{
    itemId: string;
    title: string;
    source: string;
    memoryKind?: string;
    omittedReason?: string;
    scoreBreakdown?: Record<string, number>;
  }>;
  experienceQueryPlan?: {
    enabled: boolean;
    query: string;
    limit: number;
    targetLayers: string[];
    reason: string;
    providerIds: string[];
  };
  hitReason?: string;
  evictionReason?: string;
  durableRecallSource?: string;
  decisionCodes?: Record<string, string>;
};

export type QueryContextHookSectionDiff = {
  hook: string;
  mutation: QueryContextHookMutationSummary;
  activeSectionIds: {
    system_prompt: string[];
    system_context: string[];
    user_context: string[];
  };
};

export type QueryContextProviderRequestSnapshot = {
  queryContextHash: string;
  cacheIdentity?: {
    queryContextHash: string;
    forkContextMessagesHash: string;
    envelopeHash: string;
  };
  promptChars: number;
  systemPromptChars: number;
  sectionTokenUsage: QueryContextSectionTokenUsage;
  hookSectionDiffs?: QueryContextHookSectionDiff[];
  contextBudget?: QueryContextBudgetDiagnostics;
  decisionCodes?: Record<string, string>;
  sectionOrder: Array<{
    id: string;
    role: QueryContextSectionRole;
    sectionType: QueryContextSectionType;
    estimatedTokens: number;
    source?: string;
    budget?: QueryContextSectionBudget;
  }>;
};

export type QueryContextBudgetPruningAction = {
  sectionId: string;
  role: QueryContextSectionRole;
  sectionType: QueryContextSectionType;
  action: "drop" | "truncate";
  priority: NonNullable<QueryContextSectionBudget["priority"]>;
  beforeTokens: number;
  afterTokens: number;
  reason: string;
};

export type QueryContextBudgetDiagnostics = {
  windowTokens: number;
  usableInputTokens: number;
  outputReserveTokens: number;
  providerOverheadTokens: number;
  toolSchemaTokens: number;
  memoryBudgetTokens: number;
  source: ContextWindowSource;
  confidence: ModelContextBudgetConfidence;
  originalEstimatedTokens: number;
  remainingEstimatedTokens: number;
  pruningActions: QueryContextBudgetPruningAction[];
};

export type QueryContextProviderRequest = {
  queryContext: QueryContext;
  snapshot: QueryContextProviderRequestSnapshot;
};

export type QueryContext = {
  messages: AgentMessage[];
  userPrompt: string;
  userContextSections: QueryContextSection[];
  systemPromptSections: QueryContextSection[];
  systemContextSections: QueryContextSection[];
  toolContext: QueryContextToolContext;
  thinkingConfig: Record<string, unknown>;
  diagnostics?: QueryContextDiagnostics;
};

export type QueryContextModelInput = {
  messages: AgentMessage[];
  prompt: string;
  systemPrompt: string;
  toolContext: QueryContextToolContext;
  thinkingConfig: Record<string, unknown>;
  diagnostics?: QueryContextDiagnostics;
  queryContextHash: string;
};
