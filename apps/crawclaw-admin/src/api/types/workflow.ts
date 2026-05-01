export type WorkflowDeploymentState = 'draft' | 'deployed'
export type WorkflowScope = 'workspace' | 'session'
export type WorkflowTarget = 'n8n'
export type WorkflowStepKind = 'native' | 'service' | 'crawclaw_agent' | 'human_wait'
export type WorkflowExecutionStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'waiting_external'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
export type WorkflowExecutionSource = 'local' | 'local+n8n' | 'n8n'

export interface WorkflowInvocationHint {
  method?: string
  url?: string
  headers?: Record<string, string>
}

export interface WorkflowRegistryEntry {
  workflowId: string
  name: string
  description?: string
  ownerSessionKey?: string
  ownerSessionId?: string
  scope: WorkflowScope
  target: WorkflowTarget
  enabled: boolean
  safeForAutoRun: boolean
  requiresApproval: boolean
  tags: string[]
  specVersion: number
  deploymentVersion: number
  deploymentState: WorkflowDeploymentState
  n8nWorkflowId?: string
  archivedAt?: number
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  invocation?: WorkflowInvocationHint
}

export interface WorkflowFieldSpec {
  name: string
  type: string
  required: boolean
  description?: string
}

export interface WorkflowStepSpec {
  id: string
  kind: WorkflowStepKind
  title?: string
  goal?: string
  prompt?: string
  service?: string
  sourceSkill?: string
  portability?: string
  tags?: string[]
  notes?: string
  path?: string
  branchGroup?: string
  activation?: Record<string, unknown>
  compensation?: Record<string, unknown>
  terminalOnSuccess?: boolean
  serviceRequest?: Record<string, unknown>
  agent?: Record<string, unknown>
  wait?: Record<string, unknown>
  steps?: WorkflowStepSpec[]
}

export interface WorkflowSpec {
  workflowId: string
  name: string
  goal: string
  topology?: string
  description?: string
  sourceSummary?: string
  sourceWorkspaceDir?: string
  sourceAgentDir?: string
  tags: string[]
  inputs: WorkflowFieldSpec[]
  outputs: WorkflowFieldSpec[]
  steps: WorkflowStepSpec[]
  sourceSessionKey?: string
  sourceSessionId?: string
  createdAt: number
  updatedAt: number
}

export interface WorkflowExecutionStepRecord {
  stepId: string
  title?: string
  kind?: WorkflowStepKind
  path?: string
  branchGroup?: string
  status: string
  executor?: string
  startedAt?: number
  updatedAt?: number
  endedAt?: number
  summary?: string
  error?: string
  skippedReason?: string
}

export interface WorkflowExecutionEventRecord {
  at: number
  level: 'info' | 'warn' | 'error'
  type: string
  message: string
  details?: Record<string, unknown>
}

export interface WorkflowExecutionWaitState {
  kind: 'input' | 'external'
  prompt?: string
  resumeUrl?: string
  canResume: boolean
}

export interface WorkflowExecutionView {
  executionId: string
  localExecutionId?: string
  n8nExecutionId?: string
  workflowId?: string
  workflowName?: string
  n8nWorkflowId?: string
  status: WorkflowExecutionStatus
  currentStepId?: string
  currentExecutor?: string
  remoteStatus?: string
  remoteFinished?: boolean
  startedAt?: number
  updatedAt?: number
  endedAt?: number
  steps?: WorkflowExecutionStepRecord[]
  events?: WorkflowExecutionEventRecord[]
  waiting?: WorkflowExecutionWaitState
  source: WorkflowExecutionSource
}

export interface WorkflowListEntry extends WorkflowRegistryEntry {
  runCount: number
  recentExecution: WorkflowExecutionView | null
}

export interface WorkflowListResult {
  agentId?: string
  count: number
  workflows: WorkflowListEntry[]
}

export interface WorkflowGetResult {
  agentId?: string
  workflow: WorkflowRegistryEntry
  spec: WorkflowSpec
  specPath: string
  storeRoot: string
  recentExecutions: WorkflowExecutionView[]
}

export interface WorkflowRunsResult {
  agentId?: string
  count: number
  executions: WorkflowExecutionView[]
}

export interface N8nWorkflowNodeRecord extends Record<string, unknown> {
  id?: string
  name?: string
  type?: string
  typeVersion?: number
  position?: number[]
  disabled?: boolean
}

export interface N8nWorkflowRecord extends Record<string, unknown> {
  id: string
  name: string
  active?: boolean
  nodes: N8nWorkflowNodeRecord[]
  connections: Record<string, unknown>
  settings?: Record<string, unknown>
  staticData?: Record<string, unknown>
  meta?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export interface N8nExecutionRecord extends Record<string, unknown> {
  id?: string
  executionId?: string
  workflowId?: string
  status?: string
  finished?: boolean
  stoppedAt?: string | null
  startedAt?: string | null
  data?: Record<string, unknown>
}

export interface WorkflowN8nDetailsResult {
  agentId?: string
  workflow: WorkflowRegistryEntry
  remoteWorkflow: N8nWorkflowRecord
  remoteExecutions: N8nExecutionRecord[]
  remoteWorkflowUrl: string
  remoteExecutionsUrl: string
}

export interface WorkflowMutationResult {
  agentId?: string
  workflow: WorkflowRegistryEntry
  remoteWorkflow?: N8nWorkflowRecord
  compiled?: Record<string, unknown>
}

export interface WorkflowDeleteResult {
  agentId?: string
  deleted: boolean
  workflowId?: string
  removedExecutions?: number
}

export interface WorkflowExecutionActionResult {
  agentId?: string
  workflow?: WorkflowRegistryEntry
  execution: WorkflowExecutionView
}
