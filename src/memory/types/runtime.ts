import type { MediaAsset, MessageBlock, MessageMediaRef } from "./media.ts";

export interface MessageRuntimeMeta {
  providerMessageId?: string | null;
  toolUseIds?: string[];
  toolResultIds?: string[];
  thinkingSignatures?: string[];
}

export interface MessageRuntimeShapeBlock {
  type: string;
  [key: string]: unknown;
}

export interface MessageRuntimeShape {
  messageId?: string | null;
  messageUuid?: string | null;
  stopReason?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  isError?: boolean | null;
  content?: MessageRuntimeShapeBlock[] | null;
}

export interface AppendMessageInput {
  sessionId: string;
  conversationUid: string;
  role: string;
  content: string;
  contentText?: string;
  contentBlocks?: MessageBlock[];
  hasMedia?: boolean;
  primaryMediaId?: string | null;
  mediaRefs?: MessageMediaRef[];
  runtimeMeta?: MessageRuntimeMeta | null;
  runtimeShape?: MessageRuntimeShape | null;
  turnIndex: number;
  createdAt?: number;
}

export interface GmMessageRow {
  id: string;
  sessionId: string;
  conversationUid: string;
  role: string;
  content: string;
  contentText?: string;
  contentBlocks?: MessageBlock[];
  hasMedia?: boolean;
  primaryMediaId?: string | null;
  mediaRefs?: MessageMediaRef[];
  runtimeMeta?: MessageRuntimeMeta | null;
  runtimeShape?: MessageRuntimeShape | null;
  turnIndex: number;
  extracted: boolean;
  createdAt: number;
}

export interface DreamTranscriptSearchInput {
  scopeKey: string;
  sessionIds: string[];
  query: string;
  maxSessions: number;
  maxMatchesPerSession: number;
  maxTotalBytes: number;
  maxExcerptChars: number;
}

export interface DreamTranscriptSearchRow {
  sessionId: string;
  role: string;
  turnIndex: number;
  createdAt: number;
  excerpt: string;
  matchedTerm: string;
}

export interface RawEventRow {
  id: string;
  sourceType: string;
  sessionId: string | null;
  conversationUid: string | null;
  turnIndex: number | null;
  contentText: string;
  contentBlocks: MessageBlock[];
  hasMedia: boolean;
  primaryMediaId: string | null;
  sourceRef: string | null;
  status: "pending" | "normalized" | "distilled" | "archived" | "failed";
  createdAt: number;
}

export interface MediaAssetRow extends MediaAsset {}

export interface AppendRawEventInput {
  sourceType: string;
  sessionId?: string | null;
  conversationUid?: string | null;
  turnIndex?: number | null;
  contentText: string;
  contentBlocks: MessageBlock[];
  hasMedia?: boolean;
  primaryMediaId?: string | null;
  sourceRef?: string | null;
  status?: RawEventRow["status"];
  createdAt?: number;
}

export interface UpsertMediaAssetInput {
  mediaId: string;
  kind: MediaAsset["kind"];
  sourceType: MediaAsset["sourceType"];
  originalUrl?: string | null;
  localPath?: string | null;
  vaultPath?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  sha256?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  caption?: string | null;
  status?: MediaAsset["status"];
  createdAt?: number;
  updatedAt?: number;
}

export interface CreateMaintenanceRunInput {
  kind: string;
  status?: "pending" | "running" | "done" | "failed" | "cancelled";
  scope?: string | null;
  triggerSource?: string | null;
  summary?: string | null;
  metricsJson?: string | null;
  error?: string | null;
  finishedAt?: number | null;
}

export interface MaintenanceRun {
  id: string;
  kind: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  scope: string | null;
  triggerSource: string | null;
  summary: string | null;
  metricsJson: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

export interface UpdateMaintenanceRunInput {
  id: string;
  status: MaintenanceRun["status"];
  summary?: string | null;
  metricsJson?: string | null;
  error?: string | null;
  finishedAt?: number | null;
}

export interface MergeAuditInput {
  runId?: string | null;
  canonicalNodeId: string;
  mergedNodeIdsJson: string;
  score?: number | null;
  reason?: string | null;
  mode: "manual" | "semi-auto" | "auto";
  beforeSnapshotJson?: string | null;
  afterSnapshotJson?: string | null;
}

export interface MergeAudit {
  id: string;
  runId: string | null;
  canonicalNodeId: string;
  mergedNodeIdsJson: string;
  score: number | null;
  reason: string | null;
  mode: "manual" | "semi-auto" | "auto";
  beforeSnapshotJson: string | null;
  afterSnapshotJson: string | null;
  createdAt: number;
}

export interface RecallTrace {
  id: string;
  query: string;
  queryHash: string;
  mode: string;
  memoryLayer: string;
  traceJson: string;
  topResultsJson: string | null;
  source: string | null;
  createdAt: number;
}

export interface RecallTraceInput {
  query: string;
  queryHash: string;
  mode: string;
  memoryLayer: string;
  traceJson: string;
  topResultsJson?: string | null;
  source?: string | null;
}

export type PipelineJobStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "retryable"
  | "dead_letter";

export interface CreatePipelineJobInput {
  jobKind: string;
  targetRef?: string | null;
  payloadJson?: string | null;
  status?: PipelineJobStatus;
  error?: string | null;
  attempts?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpdatePipelineJobInput {
  id: string;
  status: PipelineJobStatus;
  payloadJson?: string | null;
  error?: string | null;
  attempts?: number;
  updatedAt?: number;
}

export interface PipelineJob {
  id: string;
  jobKind: string;
  targetRef: string | null;
  status: PipelineJobStatus;
  payloadJson: string | null;
  error: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface AppendDeadLetterInput {
  sourceJobId?: string | null;
  jobKind: string;
  payloadJson?: string | null;
  error?: string | null;
  createdAt?: number;
}

export interface DeadLetter {
  id: string;
  sourceJobId: string | null;
  jobKind: string;
  payloadJson: string | null;
  error: string | null;
  createdAt: number;
}

export interface AppendRecallFeedbackInput {
  traceId: string;
  itemId: string;
  selected?: boolean;
  rank?: number | null;
  usedInAnswer?: boolean;
  followupSupported?: boolean;
  createdAt?: number;
}

export interface RecallFeedback {
  id: string;
  traceId: string;
  itemId: string;
  selected: boolean;
  rank: number | null;
  usedInAnswer: boolean;
  followupSupported: boolean;
  createdAt: number;
}

export interface SessionSummaryStateRow {
  sessionId: string;
  lastSummarizedMessageId: string | null;
  lastSummaryUpdatedAt: number | null;
  tokensAtLastSummary: number;
  summaryInProgress: boolean;
  updatedAt: number;
}

export interface UpsertSessionSummaryStateInput {
  sessionId: string;
  lastSummarizedMessageId?: string | null;
  lastSummaryUpdatedAt?: number | null;
  tokensAtLastSummary?: number;
  summaryInProgress: boolean;
  updatedAt?: number;
}

export interface DurableExtractionCursorRow {
  sessionId: string;
  sessionKey: string | null;
  lastExtractedTurn: number;
  lastExtractedMessageId: string | null;
  lastRunAt: number | null;
  updatedAt: number;
}

export interface UpsertDurableExtractionCursorInput {
  sessionId: string;
  sessionKey?: string | null;
  lastExtractedTurn: number;
  lastExtractedMessageId?: string | null;
  lastRunAt?: number | null;
  updatedAt?: number;
}

export interface UpsertSessionScopeInput {
  sessionId: string;
  sessionKey?: string | null;
  scopeKey: string;
  agentId?: string | null;
  channel?: string | null;
  userId?: string | null;
  updatedAt?: number;
}

export interface DreamStateRow {
  scopeKey: string;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  lastFailureAt: number | null;
  lastSkipReason: string | null;
  lockOwner: string | null;
  lockAcquiredAt: number | null;
  lastRunId: string | null;
  updatedAt: number;
}

export interface DreamLockAcquireResult {
  acquired: boolean;
  state: DreamStateRow;
}

export interface TouchDreamAttemptInput {
  scopeKey: string;
  now?: number;
  reason?: string | null;
}

export interface AcquireDreamLockInput {
  scopeKey: string;
  owner: string;
  staleAfterMs: number;
  now?: number;
}

export interface ReleaseDreamLockInput {
  scopeKey: string;
  owner: string;
  status: "succeeded" | "failed" | "cancelled";
  runId?: string | null;
  now?: number;
}

export interface SessionCompactionStateRow {
  sessionId: string;
  preservedTailStartTurn: number;
  preservedTailMessageId: string | null;
  summarizedThroughMessageId: string | null;
  mode: string | null;
  summaryOverrideText: string | null;
  updatedAt: number;
}

export interface UpsertSessionCompactionStateInput {
  sessionId: string;
  preservedTailStartTurn: number;
  preservedTailMessageId?: string | null;
  summarizedThroughMessageId?: string | null;
  mode?: string | null;
  summaryOverrideText?: string | null;
  updatedAt?: number;
}

export type CompactionAuditKind = "compact" | "rewrite";

export interface AppendCompactionAuditInput {
  sessionId: string;
  kind: CompactionAuditKind;
  trigger?: string | null;
  reason?: string | null;
  tokenBudget?: number | null;
  currentTokenCount?: number | null;
  tokensBefore?: number | null;
  tokensAfter?: number | null;
  preservedTailStartTurn?: number | null;
  summarizedMessages?: number | null;
  keptMessages?: number | null;
  rewrittenEntries?: number | null;
  bytesFreed?: number | null;
  skippedAlreadyCompacted?: number | null;
  skippedShort?: number | null;
  detailsJson?: string | null;
  createdAt?: number;
}

export interface CompactionAudit {
  id: string;
  sessionId: string;
  kind: CompactionAuditKind;
  trigger: string | null;
  reason: string | null;
  tokenBudget: number | null;
  currentTokenCount: number | null;
  tokensBefore: number | null;
  tokensAfter: number | null;
  preservedTailStartTurn: number | null;
  summarizedMessages: number | null;
  keptMessages: number | null;
  rewrittenEntries: number | null;
  bytesFreed: number | null;
  skippedAlreadyCompacted: number | null;
  skippedShort: number | null;
  detailsJson: string | null;
  createdAt: number;
}

export interface AppendContextAssemblyAuditInput {
  sessionId: string;
  prompt?: string | null;
  rawMessageCount: number;
  compactedMessageCount: number;
  rawMessageTokens: number;
  compactedMessageTokens: number;
  sessionSummaryTokens?: number | null;
  recallTokens?: number | null;
  systemContextTokens?: number | null;
  preservedTailStartTurn?: number | null;
  compactionStatePresent?: boolean;
  compactionMode?: string | null;
  detailsJson?: string | null;
  createdAt?: number;
}

export interface ContextAssemblyAudit {
  id: string;
  sessionId: string;
  prompt: string | null;
  rawMessageCount: number;
  compactedMessageCount: number;
  rawMessageTokens: number;
  compactedMessageTokens: number;
  sessionSummaryTokens: number | null;
  recallTokens: number | null;
  systemContextTokens: number | null;
  preservedTailStartTurn: number | null;
  compactionStatePresent: boolean;
  compactionMode: string | null;
  detailsJson: string | null;
  createdAt: number;
}

export type ContextArchiveMode = "off" | "replay" | "full";
export type ContextArchiveRunKind = "session" | "turn" | "task" | "manual";
export type ContextArchiveRunStatus = "pending" | "recording" | "complete" | "failed" | "cancelled";

export interface CreateContextArchiveRunInput {
  sessionId: string;
  conversationUid: string;
  runKind: ContextArchiveRunKind;
  archiveMode?: ContextArchiveMode;
  status?: ContextArchiveRunStatus;
  turnIndex?: number | null;
  taskId?: string | null;
  agentId?: string | null;
  parentAgentId?: string | null;
  summaryJson?: string | null;
  metadataJson?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpdateContextArchiveRunInput {
  id: string;
  status: ContextArchiveRunStatus;
  summaryJson?: string | null;
  metadataJson?: string | null;
  updatedAt?: number;
}

export interface ContextArchiveRunRow {
  id: string;
  sessionId: string;
  conversationUid: string;
  runKind: ContextArchiveRunKind;
  archiveMode: ContextArchiveMode;
  status: ContextArchiveRunStatus;
  turnIndex: number | null;
  taskId: string | null;
  agentId: string | null;
  parentAgentId: string | null;
  summaryJson: string | null;
  metadataJson: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AppendContextArchiveEventInput {
  runId: string;
  eventKind: string;
  sequence?: number;
  turnIndex?: number | null;
  payloadJson: string;
  payloadHash?: string | null;
  createdAt?: number;
}

export interface ContextArchiveEventRow {
  id: string;
  runId: string;
  eventKind: string;
  sequence: number;
  turnIndex: number | null;
  payloadJson: string;
  payloadHash: string | null;
  createdAt: number;
}

export interface UpsertContextArchiveBlobInput {
  runId: string;
  blobKey: string;
  blobHash: string;
  blobKind?: string;
  storagePath?: string | null;
  contentType?: string | null;
  byteLength?: number | null;
  metadataJson?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface ContextArchiveBlobRow {
  id: string;
  runId: string;
  blobKey: string;
  blobHash: string;
  blobKind: string | null;
  storagePath: string | null;
  contentType: string | null;
  byteLength: number | null;
  metadataJson: string | null;
  createdAt: number;
  updatedAt: number;
}

export const PROMOTION_CANDIDATE_STATUSES = [
  "pending",
  "reviewed",
  "deferred",
  "approved",
  "rejected",
  "written",
  "failed",
] as const;
export type PromotionCandidateStatus = (typeof PROMOTION_CANDIDATE_STATUSES)[number];

export const PROMOTION_REVIEW_QUEUE_STATUS_FLOW: readonly PromotionCandidateStatus[] = [
  "pending",
  "reviewed",
  "deferred",
  "approved",
  "written",
];
export const PROMOTION_REVIEW_QUEUE_ACTIVE_STATUSES: readonly PromotionCandidateStatus[] = [
  "pending",
  "reviewed",
  "deferred",
  "approved",
];
export const PROMOTION_REVIEW_QUEUE_TERMINAL_STATUSES: readonly PromotionCandidateStatus[] = [
  "written",
  "rejected",
  "failed",
];

export function isPromotionCandidateQueuedStatus(status: PromotionCandidateStatus): boolean {
  return PROMOTION_REVIEW_QUEUE_ACTIVE_STATUSES.includes(status);
}

export function isPromotionCandidateTerminalStatus(status: PromotionCandidateStatus): boolean {
  return PROMOTION_REVIEW_QUEUE_TERMINAL_STATUSES.includes(status);
}

export interface CreatePromotionCandidateInput {
  sessionId: string;
  sourceType: string;
  sourceRefsJson: string;
  candidateJson: string;
  status?: PromotionCandidateStatus;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpdatePromotionCandidateInput {
  id: string;
  status: PromotionCandidateStatus;
  sourceRefsJson?: string;
  candidateJson?: string;
  updatedAt?: number;
}

export interface PromotionCandidate {
  id: string;
  sessionId: string;
  sourceType: string;
  sourceRefsJson: string;
  candidateJson: string;
  status: PromotionCandidateStatus;
  createdAt: number;
  updatedAt: number;
}

export type KnowledgeSyncStatus = "pending" | "synced" | "failed" | "stale";

export interface UpsertKnowledgeSyncStateInput {
  notePath: string;
  noteId?: string | null;
  contentHash?: string | null;
  indexedAt?: number;
  lastError?: string | null;
  syncJson?: string | null;
  status: KnowledgeSyncStatus;
}

export interface KnowledgeSyncState {
  id: string;
  notePath: string;
  noteId: string | null;
  contentHash: string | null;
  indexedAt: number;
  lastError: string | null;
  syncJson: string | null;
  status: KnowledgeSyncStatus;
}
