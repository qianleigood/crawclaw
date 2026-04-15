export interface UpsertConversationInput {
  id: string;
  title?: string | null;
}

export interface AttachExecutionArtifactsInput {
  taskId: string;
  sessionId?: string | null;
  readFiles?: string[];
  writtenFiles?: string[];
  configKeys?: string[];
}

export interface UpsertExecutionTaskInput {
  id: string;
  name: string;
  status?: string | null;
  kind?: string | null;
  sourceSessionId?: string | null;
  totalTokens?: number | null;
  totalCost?: number | null;
  turnStart?: number | null;
  turnEnd?: number | null;
  summary?: string | null;
  error?: string | null;
  errorKind?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  readFiles?: string[];
  writtenFiles?: string[];
  configKeys?: string[];
}

export interface ExecutionTask {
  id: string;
  name: string;
  status: string | null;
  kind: string | null;
  sourceSessionId: string | null;
  totalTokens: number | null;
  totalCost: number | null;
  turnStart: number | null;
  turnEnd: number | null;
  summary: string | null;
  error: string | null;
  errorKind?: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  readFiles?: string[];
  writtenFiles?: string[];
  configKeys?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ScoredExecutionTask {
  task: ExecutionTask;
  score: number;
}

export interface ExecutionArtifactRef {
  kind: "session" | "file" | "config";
  id: string;
  label: string;
  relation?: "TRIGGERED" | "READS" | "WRITES" | "USES_CONFIG";
}

export interface ExecutionSubgraphItem {
  taskId: string;
  artifacts: ExecutionArtifactRef[];
}
