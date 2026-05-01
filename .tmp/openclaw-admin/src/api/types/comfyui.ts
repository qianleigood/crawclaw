export type ComfyUiMediaKind = 'image' | 'video' | 'audio' | 'mixed'
export type ComfyUiOutputKind = 'image' | 'video' | 'audio' | 'unknown'
export type ComfyUiRunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'timed_out'
  | 'unknown'

export type ComfyUiDiagnosticCode =
  | 'invalid_ir'
  | 'missing_node_class'
  | 'missing_required_input'
  | 'missing_reference'
  | 'invalid_choice'
  | 'type_mismatch'
  | 'missing_video_output_node'
  | 'missing_image_output_node'
  | 'planner_unavailable'

export interface ComfyUiDiagnostic {
  code: ComfyUiDiagnosticCode
  severity: 'error' | 'warning'
  nodeId?: string
  classType?: string
  field?: string
  message: string
  repairHint?: string
}

export interface ComfyUiOutputArtifact {
  kind: ComfyUiOutputKind
  nodeId: string
  filename: string
  subfolder?: string
  type?: string
  mime?: string
  localPath?: string
}

export interface ComfyUiRunRecord {
  workflowId: string
  promptId: string
  status: ComfyUiRunStatus
  startedAt: string
  completedAt?: string
  durationMs?: number
  error?: string
  outputs?: ComfyUiOutputArtifact[]
}

export interface ComfyUiWorkflowPaths {
  irPath: string
  promptPath: string
  metaPath: string
}

export interface ComfyUiWorkflowMeta {
  goal: string
  baseUrl: string
  catalogFingerprint: string
  mediaKind: ComfyUiMediaKind
  diagnostics: ComfyUiDiagnostic[]
  createdAt?: string
  updatedAt?: string
  promptId?: string
  outputs?: ComfyUiOutputArtifact[]
}

export interface ComfyUiWorkflowSummary {
  workflowId: string
  goal: string
  baseUrl: string
  catalogFingerprint: string
  mediaKind: ComfyUiMediaKind
  diagnosticsCount: number
  createdAt?: string
  updatedAt?: string
  promptId?: string
  outputCount: number
  lastRun?: ComfyUiRunRecord
  paths: ComfyUiWorkflowPaths
}

export interface ComfyUiWorkflowDetail {
  workflowId: string
  ir: Record<string, unknown>
  prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>
  meta: ComfyUiWorkflowMeta
  paths: ComfyUiWorkflowPaths
}

export interface ComfyUiOutputSummary extends ComfyUiOutputArtifact {
  workflowId: string
  promptId: string
  status: ComfyUiRunStatus
  createdAt?: string
}

export interface ComfyUiStatus {
  baseUrl: string
  workflowsDir: string
  outputDir: string
}

export interface ComfyUiWorkflowListResult {
  workflows: ComfyUiWorkflowSummary[]
}

export interface ComfyUiWorkflowGetResult {
  workflow: ComfyUiWorkflowDetail
}

export interface ComfyUiRunsResult {
  runs: ComfyUiRunRecord[]
}

export interface ComfyUiOutputsResult {
  outputs: ComfyUiOutputSummary[]
}

export interface ComfyUiValidationResult {
  ok: boolean
  action: 'validate'
  diagnostics: ComfyUiDiagnostic[]
}

export interface ComfyUiRunResult {
  ok: boolean
  action: 'run'
  promptId?: string
  queueNumber?: number
  outputs?: ComfyUiOutputArtifact[]
  diagnostics?: ComfyUiDiagnostic[]
}
