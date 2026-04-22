export interface RuntimeStoreConfig {
  type: "sqlite";
  dbPath: string;
}

export type ContextArchiveMode = "off" | "replay" | "full";

export interface ContextArchiveConfig {
  enabled?: boolean;
  mode?: ContextArchiveMode;
  rootDir?: string;
  compress?: boolean;
  redactSecrets?: boolean;
  retentionDays?: number | null;
  maxBlobBytes?: number;
  maxTotalBytes?: number | null;
}

export interface MultimodalStorageConfig {
  cacheDir: string;
  maxAssetBytes: number;
}

export interface LlmConfig {
  provider?: string;
  api?:
    | "openai-completions"
    | "openai-responses"
    | "openai-codex-responses"
    | "azure-openai-responses"
    | "anthropic-messages";
  apiKey?: string;
  baseURL?: string;
  model?: string;
  authSource?: string;
}

export interface LlmRolesConfig {
  extraction?: LlmConfig;
  governance?: LlmConfig;
  answer?: LlmConfig;
}

export interface AutomationConfig {
  enabled: boolean;
  maxJobAttempts: number;
  schedulerPollIntervalMs: number;
  stages: {
    ingest: boolean;
    distill: boolean;
    judge: boolean;
    govern: boolean;
    formalize: boolean;
    reconcile: boolean;
    maintain: boolean;
  };
}

export interface DedupPolicyConfig {
  minScore: number;
  autoApplyScore: number;
  autoRunOnWrite: boolean;
  autoRunLimit: number;
  whitelist: string[];
  blacklist: string[];
  forbidCrossTypePairs: string[];
  forbidNamePatterns: string[];
}

export interface GovernanceConfig {
  staleAfterDays: number;
  markValidationStaleWithLifecycle: boolean;
}

export interface SkillRoutingConfig {
  enabled: boolean;
  ttlMs: number;
  shortlistLimit: number;
  extraRoots: string[];
}

export interface DurableExtractionConfig {
  enabled: boolean;
  recentMessageLimit: number;
  maxNotesPerTurn: number;
  minEligibleTurnsBetweenRuns: number;
  maxConcurrentWorkers: number;
  workerIdleTtlMs: number;
}

export interface ExperienceExtractionConfig {
  enabled: boolean;
  recentMessageLimit: number;
  maxNotesPerTurn: number;
  minEligibleTurnsBetweenRuns: number;
  maxConcurrentWorkers: number;
  workerIdleTtlMs: number;
}

export interface DreamingTranscriptFallbackConfig {
  enabled: boolean;
  minSignals: number;
  staleSummaryMs: number;
  maxSessions: number;
  maxMatchesPerSession: number;
  maxTotalBytes: number;
  maxExcerptChars: number;
}

export interface DreamingConfig {
  enabled: boolean;
  minHours: number;
  minSessions: number;
  scanThrottleMs: number;
  lockStaleAfterMs: number;
  transcriptFallback?: DreamingTranscriptFallbackConfig;
}

export interface SessionSummaryConfig {
  enabled: boolean;
  rootDir?: string;
  lightInitTokenThreshold?: number;
  minTokensToInit: number;
  minTokensBetweenUpdates: number;
  toolCallsBetweenUpdates: number;
  maxWaitMs: number;
  maxTurns: number;
}

export interface NotebookLmCliConfig {
  enabled: boolean;
  command: string;
  args: string[];
  timeoutMs: number;
  limit: number;
  notebookId?: string;
  queryInstruction?: string;
}

export interface NotebookLmWriteConfig {
  enabled: boolean;
  command: string;
  args: string[];
  timeoutMs: number;
  notebookId?: string;
}

export interface NotebookLmAuthConfig {
  profile: string;
  cookieFile?: string;
  statusTtlMs: number;
  degradedCooldownMs: number;
  refreshCooldownMs: number;
  heartbeat: NotebookLmHeartbeatConfig;
}

export interface NotebookLmHeartbeatConfig {
  enabled: boolean;
  minIntervalMs: number;
  maxIntervalMs: number;
}

export interface NotebookLmConfig {
  enabled: boolean;
  auth: NotebookLmAuthConfig;
  cli: NotebookLmCliConfig;
  write: NotebookLmWriteConfig;
}

export interface NotebookLmConfigInput {
  enabled?: boolean;
  auth?: Partial<NotebookLmAuthConfig> & {
    heartbeat?: Partial<NotebookLmHeartbeatConfig>;
  };
  cli?: Partial<NotebookLmCliConfig>;
  write?: Partial<NotebookLmWriteConfig>;
}

export interface MemoryRuntimeConfig {
  runtimeStore: RuntimeStoreConfig;
  contextArchive?: ContextArchiveConfig;
  automation: AutomationConfig;
  multimodal: {
    storage: MultimodalStorageConfig;
  };
  llm?: LlmConfig;
  llms?: LlmRolesConfig;
  dedup: DedupPolicyConfig;
  governance: GovernanceConfig;
  skillRouting: SkillRoutingConfig;
  durableExtraction: DurableExtractionConfig;
  experience?: ExperienceExtractionConfig;
  dreaming: DreamingConfig;
  sessionSummary: SessionSummaryConfig;
  notebooklm: NotebookLmConfig;
}
