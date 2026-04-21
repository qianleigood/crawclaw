import type { MemoryKind } from "../recall/memory-kind.ts";
import type { MessageBlock, MessageMediaRef } from "../types/media.ts";
import type { DurableMemoryType } from "../types/orchestration.ts";
import type { PromotionCandidateStatus } from "../types/runtime.ts";

export type PromotionSourceRefKind =
  | "message"
  | "window"
  | "recall_trace"
  | "existing_note"
  | "candidate"
  | "graph_node"
  | "graph_cluster";

export interface PromotionMessageLike {
  id?: string;
  role: string;
  content: string;
  contentBlocks?: MessageBlock[];
  hasMedia?: boolean;
  primaryMediaId?: string | null;
  mediaRefs?: MessageMediaRef[];
  turnIndex?: number;
  createdAt?: number;
}

export interface PromotionWindowLike {
  id?: string;
  sessionId?: string;
  startTurn: number;
  endTurn: number;
  reason?: string;
  createdAt?: number;
}

export interface PromotionRecallTraceLike {
  id?: string;
  query?: string;
  createdAt?: number;
  traceJson?: string;
  topResultsJson?: string | null;
}

export interface PromotionSourceRef {
  kind: PromotionSourceRefKind;
  refId: string;
  sessionId?: string;
  turnIndex?: number;
  role?: string;
  startTurn?: number;
  endTurn?: number;
  query?: string;
  createdAt?: number;
  excerpt?: string;
  reason?: string;
}

export type PromotionCandidateKind = "decision" | "procedure" | "fact_cluster";
export type PromotionEvidenceStrength = "moderate" | "strong";
export type PromotionWritebackMediaMode = "preserve_primary" | "include_all" | "omit";
export type PromotionMemoryBucket = "durable" | "knowledge";

export interface PromotionCandidateMediaItem {
  mediaId: string;
  kind: "image" | "file";
  role?: "primary" | "supporting";
  url?: string;
  path?: string;
  mimeType?: string;
  alt?: string;
  caption?: string;
  title?: string;
  name?: string;
  sourceMessageId?: string;
  sourceTurnIndex?: number;
}

export interface PromotionMergeCandidateHint {
  title: string;
  nodeId?: string;
  notePath?: string;
  reason?: string;
  score?: number;
}

export interface PromotionDistillationMeta {
  strategy: "llm" | "rules" | "legacy_graph";
  fallbackReason?: string;
  model?: string;
}

export interface PromotionConflictAssessment {
  type: "none" | "duplicate" | "supplement" | "contradiction" | "uncertain";
  summary: string;
  existingRefs?: string[];
}

export interface PromotionGovernanceMeta {
  strategy: "llm_rules_hybrid" | "rules_only";
  finalAction: "auto_reject" | "graph_only" | "review_required" | "auto_approved";
  confidenceScore: number;
  stabilityScore: number;
  formalizationScore: number;
  reuseScore: number;
  riskScore: number;
  targetLayer: "key_decisions" | "sop" | "preferences" | "runtime_signals" | "sources";
  targetBucket?: PromotionMemoryBucket;
  targetDurableMemoryType?: DurableMemoryType;
  targetRefSuggestion?: string;
  llmReasoning?: string;
  llmAvailable: boolean;
  conflictAssessment?: PromotionConflictAssessment;
}

export interface PromotionCandidatePayload {
  schemaVersion: "promotion-candidate.v1";
  surface: "governance_only";
  kind: PromotionCandidateKind;
  // Promotion candidates are governance artifacts. They do not participate in
  // prompt-time recall until some later workflow explicitly writes them into a
  // recallable durable or knowledge surface.
  memoryBucket?: PromotionMemoryBucket;
  memoryKind?: MemoryKind;
  durableMemoryType?: DurableMemoryType;
  title: string;
  summary: string;
  visualSummary?: string;
  facts: string[];
  tags: string[];
  confidence: number;
  evidenceStrength: PromotionEvidenceStrength;
  evidenceMode?: "text" | "image" | "multimodal";
  primaryMediaId?: string | null;
  mediaIds?: string[];
  mediaItems?: PromotionCandidateMediaItem[];
  writebackMediaMode?: PromotionWritebackMediaMode;
  whyWorthPromoting: string;
  sourceHint: string;
  riskFlags?: string[];
  mergeCandidates?: PromotionMergeCandidateHint[];
  targetHint?: string;
  distillationMeta?: PromotionDistillationMeta;
  governance?: PromotionGovernanceMeta;
}

export function projectPromotionCandidateMemoryKind(kind: PromotionCandidateKind): MemoryKind {
  if (kind === "procedure") {
    return "procedure";
  }
  if (kind === "decision") {
    return "decision";
  }
  return "reference";
}

function normalizedSignalText(
  payload: Pick<PromotionCandidatePayload, "title" | "summary" | "facts" | "tags" | "targetHint">,
): string {
  return [
    payload.title,
    payload.summary,
    ...(payload.facts ?? []),
    ...(payload.tags ?? []),
    payload.targetHint ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

export function inferPromotionDurableMemoryType(
  payload: Pick<
    PromotionCandidatePayload,
    | "memoryBucket"
    | "durableMemoryType"
    | "memoryKind"
    | "title"
    | "summary"
    | "facts"
    | "tags"
    | "targetHint"
  >,
): DurableMemoryType | null {
  if (payload.memoryBucket === "knowledge") {
    return null;
  }
  if (payload.durableMemoryType) {
    return payload.durableMemoryType;
  }

  const text = normalizedSignalText(payload);
  const tags = new Set(
    (payload.tags ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean),
  );

  if (
    tags.has("feedback") ||
    tags.has("preference") ||
    tags.has("preferences") ||
    /(prefer|preference|feedback|默认|习惯|总是|不要|先给|回答风格|交付方式)/i.test(text)
  ) {
    return "feedback";
  }
  if (
    tags.has("user") ||
    tags.has("person") ||
    tags.has("people") ||
    tags.has("profile") ||
    /(user|persona|profile|maintainer|owner|负责人|对接人|用户画像|角色分工)/i.test(text)
  ) {
    return "user";
  }
  if (
    tags.has("project") ||
    tags.has("projects") ||
    /(project|roadmap|milestone|release train|项目|版本冻结|里程碑|范围|目标)/i.test(text)
  ) {
    return "project";
  }
  if (
    payload.memoryKind === "reference" ||
    tags.has("reference") ||
    tags.has("doc") ||
    tags.has("docs") ||
    tags.has("link") ||
    tags.has("links") ||
    /(reference|doc|docs|runbook link|dashboard|wiki|notion|notebooklm|grafana|linear|参考资料|文档入口|在哪里看)/i.test(
      text,
    )
  ) {
    return "reference";
  }
  return null;
}

export function inferPromotionMemoryBucket(
  payload: Pick<
    PromotionCandidatePayload,
    | "memoryBucket"
    | "durableMemoryType"
    | "memoryKind"
    | "title"
    | "summary"
    | "facts"
    | "tags"
    | "targetHint"
  >,
): PromotionMemoryBucket {
  if (payload.memoryBucket) {
    return payload.memoryBucket;
  }
  return inferPromotionDurableMemoryType(payload) ? "durable" : "knowledge";
}

export function inferPromotionTargetLayer(
  payload: Pick<
    PromotionCandidatePayload,
    | "memoryBucket"
    | "durableMemoryType"
    | "memoryKind"
    | "kind"
    | "title"
    | "summary"
    | "facts"
    | "tags"
    | "targetHint"
  >,
): PromotionGovernanceMeta["targetLayer"] {
  const bucket = inferPromotionMemoryBucket(payload);
  if (bucket === "durable") {
    const durableType = inferPromotionDurableMemoryType(payload);
    if (durableType === "feedback") {
      return "preferences";
    }
    return "sources";
  }
  if (payload.kind === "decision" || payload.memoryKind === "decision") {
    return "key_decisions";
  }
  if (payload.kind === "procedure" || payload.memoryKind === "procedure") {
    return "sop";
  }
  if (payload.memoryKind === "runtime_pattern") {
    return "runtime_signals";
  }
  return "sources";
}

export function mapPromotionPayloadToNoteType(
  payload: Pick<
    PromotionCandidatePayload,
    | "memoryBucket"
    | "durableMemoryType"
    | "memoryKind"
    | "kind"
    | "title"
    | "summary"
    | "facts"
    | "tags"
    | "targetHint"
  >,
): string {
  const bucket = inferPromotionMemoryBucket(payload);
  if (bucket === "durable") {
    const durableType = inferPromotionDurableMemoryType(payload);
    if (durableType === "feedback") {
      return "preference";
    }
    if (durableType === "user") {
      return "profile";
    }
    if (durableType === "project") {
      return "project";
    }
    return "reference";
  }
  if (payload.kind === "decision") {
    return "decision";
  }
  if (payload.kind === "procedure") {
    return "sop";
  }
  return "concept";
}

export function derivePromotionTargetFolder(
  payload: Pick<
    PromotionCandidatePayload,
    | "memoryBucket"
    | "durableMemoryType"
    | "memoryKind"
    | "kind"
    | "title"
    | "summary"
    | "facts"
    | "tags"
    | "targetHint"
  >,
): string {
  const noteType = mapPromotionPayloadToNoteType(payload);
  if (noteType === "project") {
    return "20 Projects";
  }
  if (noteType === "profile") {
    return "30 People";
  }
  if (noteType === "decision") {
    return "40 Decisions";
  }
  if (noteType === "sop") {
    return "50 SOP";
  }
  if (noteType === "preference") {
    return "60 Preferences";
  }
  if (noteType === "reference") {
    return "80 References";
  }
  return "70 Concepts";
}

export interface PromotionCandidateDraft {
  sessionId: string;
  sourceType: string;
  sourceRefs: PromotionSourceRef[];
  sourceRefsJson: string;
  candidate: PromotionCandidatePayload;
  candidateJson: string;
  status: PromotionCandidateStatus;
}

export interface PromotionWindowBundle {
  window: PromotionWindowLike;
  messages: PromotionMessageLike[];
}

export interface CandidateExtractorInput {
  sessionId: string;
  windows?: PromotionWindowBundle[];
  messages?: PromotionMessageLike[];
  recallTraces?: PromotionRecallTraceLike[];
  maxCandidates?: number;
}

export interface CandidateExtractorResult {
  candidates: PromotionCandidateDraft[];
  diagnostics: {
    scannedWindowCount: number;
    scannedMessageCount: number;
    skippedWindows: Array<{ refId: string; reason: string }>;
  };
}
