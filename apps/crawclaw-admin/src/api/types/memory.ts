export type MemoryMode = 'query' | 'write'

export type MemoryProviderLifecycle = 'ready' | 'degraded' | 'refreshing' | 'expired'

export interface MemoryProviderStatus {
  provider: 'notebooklm'
  enabled: boolean
  ready: boolean
  lifecycle: MemoryProviderLifecycle
  reason: string | null
  recommendedAction: string | null
  profile: string
  notebookId: string | null
  refreshAttempted: boolean
  refreshSucceeded: boolean
  authSource: string | null
  lastValidatedAt: string
  lastRefreshAt: string | null
  nextProbeAt: string | null
  nextAllowedRefreshAt: string | null
  details: string | null
}

export interface MemoryDurableIndexEntry {
  id: string
  relativePath: string
  title: string
  scopeKey: string
  agentId: string
  channel: string
  userId: string
  updatedAt: string
  sizeBytes: number
  noteCount: number
}

export interface MemoryDurableIndexListResult {
  items: MemoryDurableIndexEntry[]
}

export interface MemoryDurableIndexDocumentResult {
  item: MemoryDurableIndexEntry
  content: string
}

export type MemoryExperienceOutboxStatus = 'active' | 'stale' | 'superseded' | 'archived'
export type MemoryExperienceSyncStatus = 'synced' | 'pending_sync' | 'failed'

export interface MemoryExperienceOutboxEntry extends Record<string, unknown> {
  id: string
  title: string
  summary?: string
  content?: string
  type?: string
  layer?: string
  memoryKind?: string
  noteId?: string | null
  notebookId?: string
  dedupeKey?: string | null
  aliases?: string[]
  tags?: string[]
  status: MemoryExperienceOutboxStatus
  supersededBy?: string | null
  archivedAt?: number | null
  syncStatus?: MemoryExperienceSyncStatus
  syncAttempts?: number
  lastSyncAttemptAt?: number | null
  lastSyncError?: string | null
  updatedAt?: number
}

export interface MemoryExperienceOutboxListResult {
  items: MemoryExperienceOutboxEntry[]
}

export interface MemoryAdminOverview {
  generatedAt: string
  provider: MemoryProviderStatus
  runtime: {
    storePath: string
  }
  durable: {
    items: MemoryDurableIndexEntry[]
    visibleCount: number
    recentUpdatedAt: string | null
  }
  experience: {
    items: MemoryExperienceOutboxEntry[]
    visibleCount: number
    statusCounts: Record<MemoryExperienceOutboxStatus, number>
    syncStatusCounts: Record<MemoryExperienceSyncStatus, number>
    pendingSyncCount: number
  }
  dreaming: {
    enabled: boolean
    minHours: number
    minSessions: number
    scanThrottleMs: number
    lockStaleAfterMs: number
  }
  sessionSummary: {
    enabled: boolean
    rootDir?: string
    lightInitTokenThreshold?: number
    minTokensToInit: number
    minTokensBetweenUpdates: number
    toolCallsBetweenUpdates: number
    maxWaitMs: number
    maxTurns: number
  }
}

export interface MemoryAdminOverviewParams {
  mode?: MemoryMode
  durableLimit?: number
  experienceLimit?: number
}

export interface MemoryExperienceOutboxListParams {
  status?: MemoryExperienceOutboxStatus
  limit?: number
}

export interface MemorySessionSummaryState {
  lastSummarizedMessageId?: string | null
  lastSummaryUpdatedAt?: string | null
  tokensAtLastSummary?: number | null
  summaryInProgress?: boolean
}

export interface MemorySessionSummarySections {
  currentState: string
  openLoops: string
  taskSpecification: string
  keyResults: string
  errorsAndCorrections: string
}

export interface MemorySessionSummaryStatusResult {
  agentId: string
  sessionId: string
  summaryPath: string
  exists: boolean
  updatedAt: string | null
  profile: 'light' | 'full' | null
  state: MemorySessionSummaryState | null
  sections: MemorySessionSummarySections
}

export interface MemorySessionSummaryStatusParams {
  agent?: string
  sessionId: string
}

export interface MemorySessionSummaryRefreshParams {
  agent?: string
  sessionId: string
  sessionKey: string
  force?: boolean
}

export interface MemorySessionSummaryRefreshResult {
  agentId: string
  sessionId: string
  sessionKey: string
  result: {
    status: string
    reason?: string | null
    runId?: string | null
  }
}
