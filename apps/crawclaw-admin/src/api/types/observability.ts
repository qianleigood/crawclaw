export type ObservationSource =
  | 'lifecycle'
  | 'diagnostic'
  | 'action'
  | 'archive'
  | 'trajectory'
  | 'log'
  | 'otel'

export type ObservationRunStatus =
  | 'running'
  | 'ok'
  | 'error'
  | 'timeout'
  | 'archived'
  | 'unknown'

export interface ObservationRunsListParams {
  query?: string
  status?: ObservationRunStatus
  source?: ObservationSource
  limit?: number
  cursor?: string
  from?: number
  to?: number
}

export interface ObservationRunSummary {
  runId?: string
  taskId?: string
  traceId: string
  sessionId?: string
  sessionKey?: string
  agentId?: string
  status: ObservationRunStatus
  startedAt?: number
  endedAt?: number
  lastEventAt?: number
  eventCount: number
  errorCount: number
  sources: ObservationSource[]
  summary: string
}

export interface ObservationRunsListResult {
  items: ObservationRunSummary[]
  nextCursor?: string
  generatedAt: number
}

export interface ObservationInspectParams {
  runId?: string
  taskId?: string
  traceId?: string
}

export interface ObservationTimelineEntry {
  eventId: string
  type: string
  phase?: string
  createdAt: number
  source?: ObservationSource
  traceId?: string
  spanId?: string
  parentSpanId?: string | null
  status?: string
  decisionCode?: string
  decisionSummary?: string
  summary: string
  metrics?: Record<string, number>
  refs?: Record<string, string | number | boolean | null>
}

export interface ObservationInspectionSnapshot {
  lookup: ObservationInspectParams
  runId?: string
  taskId?: string
  timeline?: ObservationTimelineEntry[]
  refs: Record<string, string>
  warnings: string[]
}
