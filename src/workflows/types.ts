export type WorkflowStepKind = "native" | "service" | "crawclaw_agent" | "human_wait";

export type WorkflowTopology = "linear_v1" | "branch_v2";

export type WorkflowPortability =
  | "native"
  | "service"
  | "crawclaw_agent"
  | "human"
  | "non_portable";

export type WorkflowHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type WorkflowFieldSpec = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
};

export type WorkflowStepActivationMode = "sequential" | "conditional" | "fan_out" | "fan_in";

export type WorkflowFanOutFailurePolicy = "fail_fast" | "continue";

export type WorkflowFanOutJoinPolicy = "all" | "best_effort";

export type WorkflowCompensationMode = "none" | "crawclaw_agent";

export type WorkflowStepParallelSpec = {
  failurePolicy?: WorkflowFanOutFailurePolicy;
  joinPolicy?: WorkflowFanOutJoinPolicy;
  maxActiveBranches?: number;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTriesMs?: number;
};

export type WorkflowStepCompensationSpec = {
  mode?: WorkflowCompensationMode;
  goal?: string;
  allowedTools?: string[];
  allowedSkills?: string[];
  timeoutMs?: number;
  maxSteps?: number;
};

export type WorkflowStepActivationSpec = {
  mode?: WorkflowStepActivationMode;
  when?: string;
  fromStepIds?: string[];
  parallel?: WorkflowStepParallelSpec;
};

export type WorkflowBranchResolutionMode = "exclusive" | "parallel";

export type WorkflowStepSpec = {
  id: string;
  kind: WorkflowStepKind;
  title?: string;
  goal?: string;
  prompt?: string;
  service?: string;
  sourceSkill?: string;
  portability?: WorkflowPortability;
  tags?: string[];
  notes?: string;
  path?: string;
  branchGroup?: string;
  activation?: WorkflowStepActivationSpec;
  compensation?: WorkflowStepCompensationSpec;
  terminalOnSuccess?: boolean;
  serviceRequest?: {
    url: string;
    method?: WorkflowHttpMethod;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  };
  agent?: {
    allowedTools?: string[];
    allowedSkills?: string[];
    timeoutMs?: number;
    maxSteps?: number;
    resultSchema?: Record<string, unknown>;
  };
  wait?: {
    kind?: "input" | "external";
    prompt?: string;
  };
};

export type WorkflowSpec = {
  workflowId: string;
  name: string;
  goal: string;
  topology?: WorkflowTopology;
  description?: string;
  sourceSummary?: string;
  sourceWorkspaceDir?: string;
  sourceAgentDir?: string;
  tags: string[];
  inputs: WorkflowFieldSpec[];
  outputs: WorkflowFieldSpec[];
  steps: WorkflowStepSpec[];
  sourceSessionKey?: string;
  sourceSessionId?: string;
  createdAt: number;
  updatedAt: number;
};

export type WorkflowRegistryEntry = {
  workflowId: string;
  name: string;
  description?: string;
  ownerSessionKey?: string;
  ownerSessionId?: string;
  scope: "workspace" | "session";
  target: "n8n";
  enabled: boolean;
  safeForAutoRun: boolean;
  requiresApproval: boolean;
  tags: string[];
  specVersion: number;
  deploymentVersion: number;
  deploymentState: "draft" | "deployed";
  n8nWorkflowId?: string;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
};

export type WorkflowVersionSnapshot = {
  workflowId: string;
  specVersion: number;
  savedAt: number;
  savedBySessionKey?: string;
  reason: string;
  spec: WorkflowSpec;
  policy: Pick<
    WorkflowRegistryEntry,
    "description" | "enabled" | "safeForAutoRun" | "requiresApproval" | "tags" | "archivedAt"
  >;
};

export type WorkflowDeploymentRecord = {
  workflowId: string;
  deploymentVersion: number;
  specVersion: number;
  n8nWorkflowId: string;
  publishedAt: number;
  publishedBySessionKey?: string;
  summary?: string;
};

export type WorkflowDeploymentStore = {
  version: 1;
  updatedAt: number;
  deployments: WorkflowDeploymentRecord[];
};

export type WorkflowDefinitionPatch = {
  name?: string;
  goal?: string;
  description?: string | null;
  sourceSummary?: string | null;
  tags?: string[];
  inputs?: WorkflowFieldSpec[];
  outputs?: WorkflowFieldSpec[];
  topology?: WorkflowTopology;
  steps?: WorkflowStepSpec[];
  safeForAutoRun?: boolean;
  requiresApproval?: boolean;
};

export type WorkflowFieldDiff = {
  field: string;
  before?: unknown;
  after?: unknown;
};

export type WorkflowStepDiff = {
  stepId: string;
  change: "added" | "removed" | "updated";
  before?: WorkflowStepSpec;
  after?: WorkflowStepSpec;
  fields?: WorkflowFieldDiff[];
};

export type WorkflowDefinitionDiff = {
  summary: {
    basicChanged: boolean;
    inputsChanged: boolean;
    outputsChanged: boolean;
    policyChanged: boolean;
    stepsAdded: number;
    stepsRemoved: number;
    stepsUpdated: number;
  };
  changes: {
    basic: WorkflowFieldDiff[];
    inputs: WorkflowFieldDiff[];
    outputs: WorkflowFieldDiff[];
    policy: WorkflowFieldDiff[];
    steps: WorkflowStepDiff[];
  };
};

export type WorkflowInvocationHint = {
  canRun: boolean;
  autoRunnable: boolean;
  recommendedAction: "run" | "ask" | "skip";
  reason: string;
};

export type WorkflowRegistryStore = {
  version: 1;
  updatedAt: number;
  workflows: WorkflowRegistryEntry[];
};

export type WorkflowExecutionStatus =
  | "queued"
  | "running"
  | "waiting_input"
  | "waiting_external"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkflowExecutionExecutor = "n8n" | "crawclaw_agent" | "n8n_wait";

export type WorkflowExecutionStepStatus =
  | "pending"
  | "running"
  | "waiting"
  | "skipped"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkflowExecutionCompensationStatus = "running" | "succeeded" | "failed" | "cancelled";

export type WorkflowExecutionStepRecord = {
  stepId: string;
  title?: string;
  kind?: WorkflowStepKind;
  path?: string;
  branchGroup?: string;
  branchResolution?: WorkflowBranchResolutionMode;
  parallelFailurePolicy?: WorkflowFanOutFailurePolicy;
  parallelJoinPolicy?: WorkflowFanOutJoinPolicy;
  maxActiveBranches?: number;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTriesMs?: number;
  compensationMode?: WorkflowCompensationMode;
  compensationStatus?: WorkflowExecutionCompensationStatus;
  compensationSummary?: string;
  compensationError?: string;
  activationMode?: WorkflowStepActivationMode;
  activationWhen?: string;
  activationFromStepIds?: string[];
  terminalOnSuccess?: boolean;
  status: WorkflowExecutionStepStatus;
  executor?: WorkflowExecutionExecutor;
  startedAt?: number;
  updatedAt: number;
  endedAt?: number;
  summary?: string;
  error?: string;
  skippedReason?: string;
};

export type WorkflowExecutionEventLevel = "info" | "warn" | "error";

export type WorkflowExecutionEventRecord = {
  at: number;
  level: WorkflowExecutionEventLevel;
  type: string;
  message: string;
  details?: Record<string, unknown>;
};

export type WorkflowExecutionWaitState = {
  kind: "input" | "external";
  prompt?: string;
  resumeUrl?: string;
  canResume: boolean;
};

export type WorkflowExecutionVisibilityMode = "off" | "summary" | "verbose" | "full";

export type WorkflowExecutionRecord = {
  executionId: string;
  workflowId: string;
  workflowName?: string;
  topology?: WorkflowTopology;
  originRunId?: string;
  originWorkspaceDir?: string;
  originAgentDir?: string;
  originSessionKey?: string;
  originSessionId?: string;
  originTaskId?: string;
  originAgentId?: string;
  originParentAgentId?: string;
  originToolCallId?: string;
  originVisibilityMode?: WorkflowExecutionVisibilityMode;
  n8nWorkflowId?: string;
  n8nExecutionId?: string;
  status: WorkflowExecutionStatus;
  currentStepId?: string;
  currentExecutor?: WorkflowExecutionExecutor;
  remoteStatus?: string;
  remoteFinished?: boolean;
  errorMessage?: string;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  steps?: WorkflowExecutionStepRecord[];
  events?: WorkflowExecutionEventRecord[];
};

export type WorkflowExecutionStore = {
  version: 1;
  updatedAt: number;
  executions: WorkflowExecutionRecord[];
};

export type WorkflowExecutionView = {
  executionId: string;
  localExecutionId?: string;
  n8nExecutionId?: string;
  workflowId?: string;
  workflowName?: string;
  n8nWorkflowId?: string;
  status: WorkflowExecutionStatus;
  currentStepId?: string;
  currentExecutor?: WorkflowExecutionExecutor;
  remoteStatus?: string;
  remoteFinished?: boolean;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  steps?: WorkflowExecutionStepRecord[];
  events?: WorkflowExecutionEventRecord[];
  waiting?: {
    kind: WorkflowExecutionWaitState["kind"];
    prompt?: string;
    resumeUrl?: string;
    canResume: boolean;
  };
  source: "local" | "local+n8n" | "n8n";
};
