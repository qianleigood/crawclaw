import { DEFAULT_NOTEBOOKLM_CONFIG } from "./notebooklm.ts";
import type { MemoryRuntimeConfig } from "../types/config.ts";

export const DEFAULT_CONFIG: MemoryRuntimeConfig = {
  runtimeStore: {
    type: "sqlite",
    dbPath: "~/.crawclaw/memory-runtime.db",
  },
  contextArchive: {
    mode: "off",
    rootDir: "~/.crawclaw/context-archive",
    compress: true,
    redactSecrets: true,
    retentionDays: 30,
    maxBlobBytes: 4 * 1024 * 1024,
    maxTotalBytes: 512 * 1024 * 1024,
  },
  automation: {
    enabled: false,
    maxJobAttempts: 3,
    schedulerPollIntervalMs: 15_000,
    extractionJobTimeoutMs: 120_000,
    stages: {
      ingest: true,
      distill: true,
      judge: true,
      govern: true,
      formalize: true,
      reconcile: true,
      maintain: true,
    },
  },
  multimodal: {
    storage: {
      cacheDir: "~/.crawclaw/memory-media",
      maxAssetBytes: 20 * 1024 * 1024,
    },
  },
  llm: undefined,
  llms: undefined,
  dedup: {
    minScore: 0.62,
    autoApplyScore: 0.85,
    autoRunOnWrite: false,
    autoRunLimit: 200,
    whitelist: [],
    blacklist: [],
    forbidCrossTypePairs: ["EVENT:SKILL", "SKILL:EVENT", "TASK:EVENT:PATCHES"],
    forbidNamePatterns: ["root-cause", "symptom", "temporary-fix", "permanent-fix"],
  },
  governance: {
    staleAfterDays: 30,
    markValidationStaleWithLifecycle: true,
  },
  skillRouting: {
    enabled: true,
    ttlMs: 60_000,
    shortlistLimit: 5,
    extraRoots: [],
  },
  durableExtraction: {
    enabled: true,
    recentMessageLimit: 24,
    maxNotesPerTurn: 2,
    minEligibleTurnsBetweenRuns: 1,
    maxConcurrentWorkers: 2,
    workerIdleTtlMs: 15 * 60_000,
  },
  dreaming: {
    enabled: false,
    minHours: 24,
    minSessions: 5,
    scanThrottleMs: 10 * 60_000,
    lockStaleAfterMs: 60 * 60_000,
  },
  sessionSummary: {
    enabled: true,
    rootDir: "~/.crawclaw",
    minTokensToInit: 10_000,
    minTokensBetweenUpdates: 5_000,
    toolCallsBetweenUpdates: 3,
    maxWaitMs: 15_000,
    maxTurns: 5,
  },
  notebooklm: DEFAULT_NOTEBOOKLM_CONFIG,
};
