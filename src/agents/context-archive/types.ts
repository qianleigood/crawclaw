import type { ObservationHistoryStore } from "../../infra/observation/history-index.js";

export type ContextArchiveMode = "off" | "replay" | "full";
export type ContextArchiveRunKind = "session" | "turn" | "task" | "manual";
export type ContextArchiveRunStatus = "pending" | "recording" | "complete" | "failed" | "cancelled";

export type ContextArchiveBlobEncoding = "utf8" | "base64";

export type ContextArchiveBlobInput = {
  runId: string;
  blobKey: string;
  content: unknown;
  blobKind?: string;
  contentType?: string;
  metadata?: Record<string, unknown>;
  createdAt?: number;
};

export type ContextArchiveStoredBlob = {
  blobId: string;
  sha256: string;
  contentType: string;
  encoding: ContextArchiveBlobEncoding;
  sizeBytes: number;
  createdAt: number;
  path: string;
  metaPath: string;
  metadata?: Record<string, unknown>;
};

export type ContextArchiveBlobRecord = ContextArchiveStoredBlob & {
  runId: string;
  blobKey: string;
  blobKind?: string;
  updatedAt: number;
};

export type ContextArchiveRunInput = {
  sessionId: string;
  conversationUid?: string;
  sessionKey?: string;
  taskId?: string;
  agentId?: string;
  parentAgentId?: string;
  kind?: ContextArchiveRunKind;
  archiveMode?: ContextArchiveMode;
  status?: ContextArchiveRunStatus;
  turnIndex?: number;
  label?: string;
  summary?: unknown;
  metadata?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
};

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

export type ContextArchiveRunRecord = {
  id: string;
  sessionId: string;
  conversationUid: string;
  kind: ContextArchiveRunKind;
  archiveMode: ContextArchiveMode;
  status: ContextArchiveRunStatus;
  turnIndex?: number;
  taskId?: string;
  agentId?: string;
  parentAgentId?: string;
  sessionKey?: string;
  label?: string;
  summary?: unknown;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

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

export type ContextArchiveRunRefs = {
  runRef: string;
  eventsRef: string;
  blobRefs: string[];
};

export type ContextArchiveUsageSummary = {
  runCount: number;
  blobCount: number;
  eventCount: number;
  totalBytes: number;
  oldestCreatedAt?: number;
  newestCreatedAt?: number;
};

export type ContextArchiveCleanupOptions = {
  now?: number;
  retentionDays?: number | null;
  maxBlobBytes?: number | null;
  maxTotalBytes?: number | null;
  dryRun?: boolean;
};

export type ContextArchiveCleanupReport = {
  checkedRunCount: number;
  prunedRunCount: number;
  reclaimedBytes: number;
  totalBytesBefore: number;
  totalBytesAfter: number;
  retainedRunCount: number;
  deletedRunIds: string[];
  deletedBlobHashes: string[];
  retentionCutoffAt?: number;
  maxBlobBytes?: number | null;
  maxTotalBytes?: number | null;
  dryRun: boolean;
};

export type ContextArchiveInspectionRun = ContextArchiveRunRecord & {
  refs: ContextArchiveRunRefs;
};

export type ContextArchiveInspectionSnapshot = {
  runs: ContextArchiveInspectionRun[];
};

export type ContextArchiveExportBlob = ContextArchiveBlobRecord & {
  content?: unknown;
};

export type ContextArchiveExportRun = {
  run: ContextArchiveInspectionRun;
  events: ContextArchiveEventRecord[];
  blobs: ContextArchiveExportBlob[];
};

export type ContextArchiveExportSnapshot = {
  version: 1;
  exportedAt: number;
  rootDir: string;
  filters: {
    runId?: string;
    taskId?: string;
    sessionId?: string;
    agentId?: string;
  };
  runs: ContextArchiveExportRun[];
};

export type ContextArchiveReplayTurn = {
  turnIndex: number;
  events: ContextArchiveEventRecord[];
  modelVisibleContext?: unknown;
  modelOutput?: unknown;
  toolAdmissions: unknown[];
  toolResults: unknown[];
  postTurnEvents: Array<{
    type: string;
    payload: unknown;
  }>;
};

export type ContextArchiveReplaySnapshot = {
  run: ContextArchiveInspectionRun;
  turns: ContextArchiveReplayTurn[];
};

export type ContextArchiveEventInput = {
  runId: string;
  type: string;
  turnIndex?: number;
  payload?: unknown;
  payloadContentType?: string;
  blobKeys?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: number;
};

export type ContextArchiveEventRecord = {
  id: string;
  runId: string;
  type: string;
  sequence: number;
  turnIndex?: number;
  payload?: unknown;
  payloadBlobKey?: string;
  payloadBlobHash?: string;
  payloadContentType?: string;
  blobKeys: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
};

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

export interface ContextArchiveRuntimeStore extends ObservationHistoryStore {
  createContextArchiveRun(input: CreateContextArchiveRunInput): Promise<string>;
  getContextArchiveRun(runId: string): Promise<ContextArchiveRunRow | null>;
  updateContextArchiveRun(input: UpdateContextArchiveRunInput): Promise<void>;
  listRecentContextArchiveRuns(limit: number, sessionId?: string): Promise<ContextArchiveRunRow[]>;
  listAllContextArchiveRuns(): Promise<ContextArchiveRunRow[]>;
  listContextArchiveBlobs(runId: string, limit: number): Promise<ContextArchiveBlobRow[]>;
  listContextArchiveEvents(runId: string, limit: number): Promise<ContextArchiveEventRow[]>;
  deleteContextArchiveRun(runId: string): Promise<void>;
  upsertContextArchiveBlob(input: UpsertContextArchiveBlobInput): Promise<void>;
  getContextArchiveBlob(runId: string, blobKey: string): Promise<ContextArchiveBlobRow | null>;
  appendContextArchiveEvent(input: AppendContextArchiveEventInput): Promise<string>;
}

export type ContextArchiveReadEventsOptions = {
  hydratePayload?: boolean;
  limit?: number;
};

export type ContextArchiveServiceOptions = {
  runtimeStore: ContextArchiveRuntimeStore;
  rootDir?: string;
  baseDir?: string;
  env?: NodeJS.ProcessEnv;
  defaultArchiveMode?: ContextArchiveMode;
  retentionDays?: number | null;
  maxBlobBytes?: number | null;
  maxTotalBytes?: number | null;
};
