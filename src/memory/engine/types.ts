import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { CompactPostArtifacts } from "../../agents/compaction/post-compact-artifacts.js";
import type {
  QueryContextMemoryRecallDiagnostics,
  QueryContextSection,
} from "../../agents/query-context/types.js";
import type { DurableRecallPrefetchHandle } from "../durable/prefetch.ts";

export type MemoryAssembleResult = {
  messages: AgentMessage[];
  estimatedTokens: number;
  systemContextSections?: QueryContextSection[];
  diagnostics?: {
    memoryRecall?: QueryContextMemoryRecallDiagnostics;
  };
};

export type MemoryCompactResult = {
  ok: boolean;
  compacted: boolean;
  reason?: string;
  result?: {
    summary?: string;
    firstKeptEntryId?: string;
    tokensBefore: number;
    tokensAfter?: number;
    postCompactArtifacts?: CompactPostArtifacts;
    details?: unknown;
  };
};

export type MemoryIngestResult = {
  ingested: boolean;
};

export type MemoryIngestBatchResult = {
  ingestedCount: number;
};

export type MemoryBootstrapResult = {
  bootstrapped: boolean;
  importedMessages?: number;
  reason?: string;
};

export type MemoryRuntimeInfo = {
  id: string;
  name: string;
  version?: string;
  ownsCompaction?: boolean;
};

export type MemorySubagentSpawnPreparation = {
  rollback: () => void | Promise<void>;
};

export type MemorySubagentEndReason = "deleted" | "completed" | "swept" | "released";

export type MemoryTranscriptRewriteReplacement = {
  entryId: string;
  message: AgentMessage;
};

export type MemoryTranscriptRewriteRequest = {
  replacements: MemoryTranscriptRewriteReplacement[];
};

export type MemoryTranscriptRewriteResult = {
  changed: boolean;
  bytesFreed: number;
  rewrittenEntries: number;
  reason?: string;
};

export type MemoryMaintenanceResult = MemoryTranscriptRewriteResult;

export type MemoryRuntimeContext = Record<string, unknown> & {
  rewriteTranscriptEntries?: (
    request: MemoryTranscriptRewriteRequest,
  ) => Promise<MemoryTranscriptRewriteResult>;
};

export interface MemoryRuntime {
  readonly info: MemoryRuntimeInfo;

  bootstrap?(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
  }): Promise<MemoryBootstrapResult>;

  maintain?(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    runtimeContext?: MemoryRuntimeContext;
  }): Promise<MemoryMaintenanceResult>;

  ingest(params: {
    sessionId: string;
    sessionKey?: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<MemoryIngestResult>;

  ingestBatch?(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    isHeartbeat?: boolean;
  }): Promise<MemoryIngestBatchResult>;

  afterTurn?(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
    runtimeContext?: MemoryRuntimeContext;
  }): Promise<void>;

  assemble(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    tokenBudget?: number;
    model?: string;
    prompt?: string;
    runtimeContext?: MemoryRuntimeContext;
  }): Promise<MemoryAssembleResult>;

  compact(params: {
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
    runtimeContext?: MemoryRuntimeContext;
  }): Promise<MemoryCompactResult>;

  prepareSubagentSpawn?(params: {
    parentSessionKey: string;
    childSessionKey: string;
    ttlMs?: number;
  }): Promise<MemorySubagentSpawnPreparation | undefined>;

  onSubagentEnded?(params: {
    childSessionKey: string;
    reason: MemorySubagentEndReason;
  }): Promise<void>;

  dispose?(): Promise<void>;

  startDurableRecallPrefetch?(params: {
    sessionId: string;
    sessionKey?: string;
    messages: AgentMessage[];
    prompt?: string;
    model?: string;
    runtimeContext?: MemoryRuntimeContext;
  }): DurableRecallPrefetchHandle | undefined | Promise<DurableRecallPrefetchHandle | undefined>;
}
