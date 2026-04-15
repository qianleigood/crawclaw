import type {
  ContextArchiveMode,
  ContextArchiveRunKind,
  ContextArchiveRunStatus,
} from "../../memory/types/runtime.ts";
import type { RuntimeStore } from "../../memory/runtime/runtime-store.ts";

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

export type ContextArchiveReadEventsOptions = {
  hydratePayload?: boolean;
  limit?: number;
};

export type ContextArchiveServiceOptions = {
  runtimeStore: RuntimeStore;
  rootDir?: string;
  baseDir?: string;
  env?: NodeJS.ProcessEnv;
  defaultArchiveMode?: ContextArchiveMode;
  retentionDays?: number | null;
  maxBlobBytes?: number | null;
  maxTotalBytes?: number | null;
};
