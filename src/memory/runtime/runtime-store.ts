import type {
  AppendDeadLetterInput,
  AppendMessageInput,
  AppendCompactionAuditInput,
  AppendContextAssemblyAuditInput,
  AppendContextArchiveEventInput,
  AppendRawEventInput,
  AppendRecallFeedbackInput,
  CompactionAudit,
  ContextAssemblyAudit,
  ContextArchiveBlobRow,
  ContextArchiveEventRow,
  ContextArchiveRunRow,
  CreatePipelineJobInput,
  CreateContextArchiveRunInput,
  CreateExtractionJobInput,
  CreateExtractionJobIfAbsentResult,
  CreateMaintenanceRunInput,
  CreatePromotionCandidateInput,
  DeadLetter,
  DurableExtractionCursorRow,
  DreamLockAcquireResult,
  DreamStateRow,
  ExtractionJob,
  ExtractionWindow,
  ExtractionWindowInput,
  KnowledgeSyncState,
  GmMessageRow,
  MaintenanceRun,
  MergeAudit,
  MergeAuditInput,
  PipelineJob,
  PromotionCandidate,
  RecallFeedback,
  RecallTrace,
  RecallTraceInput,
  SessionCompactionStateRow,
  SessionSummaryStateRow,
  UpdatePipelineJobInput,
  UpdateContextArchiveRunInput,
  UpdateExtractionJobInput,
  UpdateMaintenanceRunInput,
  UpdatePromotionCandidateInput,
  UpsertMediaAssetInput,
  UpsertDurableExtractionCursorInput,
  UpsertKnowledgeSyncStateInput,
  UpsertContextArchiveBlobInput,
  UpsertSessionScopeInput,
  UpsertSessionCompactionStateInput,
  UpsertSessionSummaryStateInput,
  AcquireDreamLockInput,
  ReleaseDreamLockInput,
  TouchDreamAttemptInput,
} from "../types/runtime.ts";

export interface RuntimeStore {
  init(): Promise<void>;
  appendMessage(input: AppendMessageInput): Promise<void>;
  appendRawEvent?(input: AppendRawEventInput): Promise<string>;
  upsertMediaAsset?(input: UpsertMediaAssetInput): Promise<void>;
  listUnextractedMessages(sessionId: string, limit: number): Promise<GmMessageRow[]>;
  listMessagesByTurnRange(sessionId: string, startTurn: number, endTurn: number): Promise<GmMessageRow[]>;
  listMessagesByCreatedAtRange(startTime: number, endTime: number, limit: number, sessionId?: string): Promise<GmMessageRow[]>;
  listSessionIdsByCreatedAtRange(startTime: number, endTime: number, limit: number): Promise<string[]>;
  markMessagesExtracted(messageIds: string[]): Promise<void>;
  createPipelineJob(input: CreatePipelineJobInput): Promise<string>;
  claimPipelineJob(jobKinds?: string[]): Promise<PipelineJob | null>;
  updatePipelineJob(input: UpdatePipelineJobInput): Promise<void>;
  getPipelineJob(id: string): Promise<PipelineJob | null>;
  listRecentPipelineJobs(limit: number): Promise<PipelineJob[]>;
  appendDeadLetter(input: AppendDeadLetterInput): Promise<string>;
  listRecentDeadLetters(limit: number): Promise<DeadLetter[]>;
  appendRecallFeedback(input: AppendRecallFeedbackInput): Promise<string>;
  listRecallFeedbackByTrace(traceId: string, limit?: number): Promise<RecallFeedback[]>;
  appendCompactionAudit(input: AppendCompactionAuditInput): Promise<string>;
  listRecentCompactionAudits(limit: number, sessionId?: string): Promise<CompactionAudit[]>;
  appendContextAssemblyAudit(input: AppendContextAssemblyAuditInput): Promise<string>;
  listRecentContextAssemblyAudits(limit: number, sessionId?: string): Promise<ContextAssemblyAudit[]>;
  createContextArchiveRun(input: CreateContextArchiveRunInput): Promise<string>;
  updateContextArchiveRun(input: UpdateContextArchiveRunInput): Promise<void>;
  getContextArchiveRun(id: string): Promise<ContextArchiveRunRow | null>;
  listAllContextArchiveRuns(sessionId?: string): Promise<ContextArchiveRunRow[]>;
  listRecentContextArchiveRuns(limit: number, sessionId?: string): Promise<ContextArchiveRunRow[]>;
  deleteContextArchiveRun(id: string): Promise<void>;
  appendContextArchiveEvent(input: AppendContextArchiveEventInput): Promise<string>;
  listContextArchiveEvents(runId: string, limit?: number): Promise<ContextArchiveEventRow[]>;
  upsertContextArchiveBlob(input: UpsertContextArchiveBlobInput): Promise<void>;
  getContextArchiveBlob(runId: string, blobKey: string): Promise<ContextArchiveBlobRow | null>;
  listContextArchiveBlobs(runId: string, limit?: number): Promise<ContextArchiveBlobRow[]>;
  getSessionSummaryState(sessionId: string): Promise<SessionSummaryStateRow | null>;
  upsertSessionSummaryState(input: UpsertSessionSummaryStateInput): Promise<void>;
  getDurableExtractionCursor(sessionId: string): Promise<DurableExtractionCursorRow | null>;
  upsertDurableExtractionCursor(input: UpsertDurableExtractionCursorInput): Promise<void>;
  upsertSessionScope(input: UpsertSessionScopeInput): Promise<void>;
  listScopedSessionIdsTouchedSince(scopeKey: string, sinceTime: number, excludeSessionId?: string | null, limit?: number): Promise<string[]>;
  getDreamState(scopeKey: string): Promise<DreamStateRow | null>;
  touchDreamAttempt(input: TouchDreamAttemptInput): Promise<void>;
  acquireDreamLock(input: AcquireDreamLockInput): Promise<DreamLockAcquireResult>;
  releaseDreamLock(input: ReleaseDreamLockInput): Promise<void>;
  listModelVisibleMessagesForDurableExtraction(
    sessionId: string,
    afterTurnExclusive: number,
    upToTurnInclusive: number,
    limit: number,
  ): Promise<GmMessageRow[]>;
  getSessionCompactionState(sessionId: string): Promise<SessionCompactionStateRow | null>;
  upsertSessionCompactionState(input: UpsertSessionCompactionStateInput): Promise<void>;
  clearSessionCompactionState(sessionId: string): Promise<void>;
  createExtractionJob(input: CreateExtractionJobInput): Promise<string>;
  createExtractionJobIfAbsent(input: CreateExtractionJobInput): Promise<CreateExtractionJobIfAbsentResult>;
  claimExtractionJob(): Promise<ExtractionJob | null>;
  claimExtractionJobById(jobId: string): Promise<ExtractionJob | null>;
  findExtractionJobByWindow(sessionId: string, windowHash: string, statuses?: ExtractionJob["status"][]): Promise<ExtractionJob | null>;
  updateExtractionJob(input: UpdateExtractionJobInput): Promise<void>;
  createMaintenanceRun(input: CreateMaintenanceRunInput): Promise<string>;
  updateMaintenanceRun(input: UpdateMaintenanceRunInput): Promise<void>;
  appendMergeAudit(input: MergeAuditInput): Promise<string>;
  appendRecallTrace(input: RecallTraceInput): Promise<string>;
  appendExtractionWindow(input: ExtractionWindowInput): Promise<string>;
  createPromotionCandidate(input: CreatePromotionCandidateInput): Promise<string>;
  updatePromotionCandidate(input: UpdatePromotionCandidateInput): Promise<void>;
  getPromotionCandidate(id: string): Promise<PromotionCandidate | null>;
  listRecentPromotionCandidates(limit: number): Promise<PromotionCandidate[]>;
  upsertKnowledgeSyncState(input: UpsertKnowledgeSyncStateInput): Promise<void>;
  listRecentKnowledgeSyncStates(limit: number): Promise<KnowledgeSyncState[]>;
  listRecentMaintenanceRuns(limit: number): Promise<MaintenanceRun[]>;
  listRecentMergeAudits(limit: number): Promise<MergeAudit[]>;
  listRecentRecallTraces(limit: number): Promise<RecallTrace[]>;
  listRecentExtractionJobs(limit: number): Promise<ExtractionJob[]>;
  listRecentExtractionWindows(limit: number): Promise<ExtractionWindow[]>;
  close(): Promise<void>;
}
