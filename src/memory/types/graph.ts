export type NodeType = "TASK" | "PROCEDURE" | "SKILL" | "EVENT";
export type EdgeType = "USED_SKILL" | "SOLVED_BY" | "REQUIRES" | "PATCHES" | "CONFLICTS_WITH";
export type NodeStatus = "active" | "deprecated" | "merged";
export type ValidationStatus =
  | "draft"
  | "candidate"
  | "validated"
  | "high_confidence"
  | "stale"
  | "superseded"
  | "deprecated";
export type LifecycleStage =
  | "draft"
  | "candidate"
  | "validated"
  | "high_confidence"
  | "stale"
  | "superseded"
  | "deprecated";
export type EvidenceMode = "text" | "image" | "multimodal";

export interface GmNode {
  id: string;
  type: NodeType;
  name: string;
  description: string;
  content: string;
  image?: string | null;
  imageAlt?: string | null;
  primaryMediaId?: string | null;
  mediaIds?: string[];
  mediaIdsJson?: string | null;
  evidenceMode?: EvidenceMode | null;
  visualSummary?: string | null;
  status: NodeStatus;
  validationStatus?: ValidationStatus;
  lifecycleStage?: LifecycleStage;
  confidenceScore?: number;
  promotionScore?: number | null;
  validatedCount: number;
  pagerank: number;
  communityId: string | null;
  contentHash: string | null;
  mergedInto?: string | null;
  supersededBy?: string | null;
  lastValidatedAt?: number | null;
  lastMaintainedAt?: number | null;
  staleAt?: number | null;
  supersededAt?: number | null;
  deprecatedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface GmEdge {
  id: string;
  fromId: string;
  toId: string;
  type: EdgeType;
  instruction: string;
  condition?: string | null;
  sessionId: string;
  weight?: number;
  evidenceCount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertSessionInput {
  sessionId: string;
  conversationId?: string | null;
  channel?: string | null;
  chatId?: string | null;
  startedAt?: number;
}

export interface UpsertNodeInput {
  id: string;
  type: NodeType;
  name: string;
  description: string;
  content: string;
  image?: string | null;
  imageAlt?: string | null;
  primaryMediaId?: string | null;
  mediaIds?: string[];
  mediaIdsJson?: string | null;
  evidenceMode?: EvidenceMode | null;
  visualSummary?: string | null;
  contentHash?: string | null;
  validationStatus?: ValidationStatus;
  lifecycleStage?: LifecycleStage;
  confidenceScore?: number | null;
  promotionScore?: number | null;
  supersededBy?: string | null;
  lastValidatedAt?: number | null;
  lastMaintainedAt?: number | null;
  staleAt?: number | null;
  supersededAt?: number | null;
  deprecatedAt?: number | null;
}

export interface UpsertEdgeInput {
  id: string;
  fromId: string;
  toId: string;
  type: EdgeType;
  instruction: string;
  condition?: string | null;
  sessionId: string;
}

export interface AttachSessionNodeInput {
  sessionId: string;
  nodeId: string;
}

export interface AttachDerivedFromInput {
  nodeId: string;
  sessionId?: string;
  executionTaskId?: string;
}

export interface ScoredNode {
  node: GmNode;
  score: number;
}

export function isProcedureNodeType(type: string | null | undefined): boolean {
  return type === "PROCEDURE" || type === "SKILL";
}
