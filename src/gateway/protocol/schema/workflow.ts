import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const OptionalWorkflowContextProperties = {
  agentId: Type.Optional(Type.String()),
  workspaceDir: Type.Optional(Type.String()),
  agentDir: Type.Optional(Type.String()),
} as const;

function defineWorkflowContextParamsSchema(
  fields: Record<string, TSchema>,
): ReturnType<typeof Type.Object> {
  return Type.Object(
    {
      ...OptionalWorkflowContextProperties,
      ...fields,
    },
    { additionalProperties: false },
  );
}

export const WorkflowFieldSpecSchema = Type.Object(
  {
    name: NonEmptyString,
    type: NonEmptyString,
    required: Type.Boolean(),
    description: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkflowParallelSpecSchema = Type.Object(
  {
    failurePolicy: Type.Optional(Type.Union([Type.Literal("fail_fast"), Type.Literal("continue")])),
    joinPolicy: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("best_effort")])),
    maxActiveBranches: Type.Optional(Type.Integer({ minimum: 1 })),
    retryOnFail: Type.Optional(Type.Boolean()),
    maxTries: Type.Optional(Type.Integer({ minimum: 1 })),
    waitBetweenTriesMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const WorkflowCompensationSpecSchema = Type.Object(
  {
    mode: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("crawclaw_agent")])),
    goal: Type.Optional(Type.String()),
    allowedTools: Type.Optional(Type.Array(Type.String())),
    allowedSkills: Type.Optional(Type.Array(Type.String())),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
    maxSteps: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const WorkflowActivationSpecSchema = Type.Object(
  {
    mode: Type.Optional(
      Type.Union([
        Type.Literal("sequential"),
        Type.Literal("conditional"),
        Type.Literal("fan_out"),
        Type.Literal("fan_in"),
      ]),
    ),
    when: Type.Optional(Type.String()),
    fromStepIds: Type.Optional(Type.Array(Type.String())),
    parallel: Type.Optional(WorkflowParallelSpecSchema),
  },
  { additionalProperties: false },
);

export const WorkflowStepSpecSchema = Type.Recursive((Self) =>
  Type.Object(
    {
      id: NonEmptyString,
      kind: Type.Union([
        Type.Literal("native"),
        Type.Literal("service"),
        Type.Literal("crawclaw_agent"),
        Type.Literal("human_wait"),
      ]),
      title: Type.Optional(Type.String()),
      goal: Type.Optional(Type.String()),
      prompt: Type.Optional(Type.String()),
      service: Type.Optional(Type.String()),
      sourceSkill: Type.Optional(Type.String()),
      portability: Type.Optional(
        Type.Union([
          Type.Literal("native"),
          Type.Literal("service"),
          Type.Literal("crawclaw_agent"),
          Type.Literal("human"),
          Type.Literal("non_portable"),
        ]),
      ),
      tags: Type.Optional(Type.Array(Type.String())),
      notes: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      branchGroup: Type.Optional(Type.String()),
      activation: Type.Optional(WorkflowActivationSpecSchema),
      compensation: Type.Optional(WorkflowCompensationSpecSchema),
      terminalOnSuccess: Type.Optional(Type.Boolean()),
      serviceRequest: Type.Optional(
        Type.Object(
          {
            url: NonEmptyString,
            method: Type.Optional(
              Type.Union([
                Type.Literal("GET"),
                Type.Literal("POST"),
                Type.Literal("PUT"),
                Type.Literal("PATCH"),
                Type.Literal("DELETE"),
                Type.Literal("HEAD"),
                Type.Literal("OPTIONS"),
              ]),
            ),
            headers: Type.Optional(Type.Record(Type.String(), Type.String())),
            body: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          },
          { additionalProperties: false },
        ),
      ),
      agent: Type.Optional(
        Type.Object(
          {
            allowedTools: Type.Optional(Type.Array(Type.String())),
            allowedSkills: Type.Optional(Type.Array(Type.String())),
            timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
            maxSteps: Type.Optional(Type.Integer({ minimum: 1 })),
            resultSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
          },
          { additionalProperties: false },
        ),
      ),
      wait: Type.Optional(
        Type.Object(
          {
            kind: Type.Optional(Type.Union([Type.Literal("input"), Type.Literal("external")])),
            prompt: Type.Optional(Type.String()),
          },
          { additionalProperties: false },
        ),
      ),
      // Keep recursion open for future nested step envelopes without blocking schema reuse.
      steps: Type.Optional(Type.Array(Self)),
    },
    { additionalProperties: false },
  ),
);

export const WorkflowSpecSchema = Type.Object(
  {
    workflowId: NonEmptyString,
    name: NonEmptyString,
    goal: NonEmptyString,
    topology: Type.Optional(Type.Union([Type.Literal("linear_v1"), Type.Literal("branch_v2")])),
    description: Type.Optional(Type.String()),
    sourceSummary: Type.Optional(Type.String()),
    sourceWorkspaceDir: Type.Optional(Type.String()),
    sourceAgentDir: Type.Optional(Type.String()),
    tags: Type.Array(Type.String()),
    inputs: Type.Array(WorkflowFieldSpecSchema),
    outputs: Type.Array(WorkflowFieldSpecSchema),
    steps: Type.Array(WorkflowStepSpecSchema),
    sourceSessionKey: Type.Optional(Type.String()),
    sourceSessionId: Type.Optional(Type.String()),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const WorkflowRegistryEntrySchema = Type.Object(
  {
    workflowId: NonEmptyString,
    name: NonEmptyString,
    description: Type.Optional(Type.String()),
    ownerSessionKey: Type.Optional(Type.String()),
    ownerSessionId: Type.Optional(Type.String()),
    scope: Type.Union([Type.Literal("workspace"), Type.Literal("session")]),
    target: Type.Literal("n8n"),
    enabled: Type.Boolean(),
    safeForAutoRun: Type.Boolean(),
    requiresApproval: Type.Boolean(),
    tags: Type.Array(Type.String()),
    specVersion: Type.Integer({ minimum: 0 }),
    deploymentVersion: Type.Integer({ minimum: 0 }),
    deploymentState: Type.Union([Type.Literal("draft"), Type.Literal("deployed")]),
    n8nWorkflowId: Type.Optional(Type.String()),
    archivedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
    lastRunAt: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const WorkflowExecutionStepRecordSchema = Type.Object(
  {
    stepId: NonEmptyString,
    title: Type.Optional(Type.String()),
    kind: Type.Optional(
      Type.Union([
        Type.Literal("native"),
        Type.Literal("service"),
        Type.Literal("crawclaw_agent"),
        Type.Literal("human_wait"),
      ]),
    ),
    path: Type.Optional(Type.String()),
    branchGroup: Type.Optional(Type.String()),
    branchResolution: Type.Optional(
      Type.Union([Type.Literal("exclusive"), Type.Literal("parallel")]),
    ),
    parallelFailurePolicy: Type.Optional(
      Type.Union([Type.Literal("fail_fast"), Type.Literal("continue")]),
    ),
    parallelJoinPolicy: Type.Optional(
      Type.Union([Type.Literal("all"), Type.Literal("best_effort")]),
    ),
    maxActiveBranches: Type.Optional(Type.Integer({ minimum: 1 })),
    retryOnFail: Type.Optional(Type.Boolean()),
    maxTries: Type.Optional(Type.Integer({ minimum: 1 })),
    waitBetweenTriesMs: Type.Optional(Type.Integer({ minimum: 0 })),
    compensationMode: Type.Optional(
      Type.Union([Type.Literal("none"), Type.Literal("crawclaw_agent")]),
    ),
    compensationStatus: Type.Optional(
      Type.Union([
        Type.Literal("running"),
        Type.Literal("succeeded"),
        Type.Literal("failed"),
        Type.Literal("cancelled"),
      ]),
    ),
    compensationSummary: Type.Optional(Type.String()),
    compensationError: Type.Optional(Type.String()),
    activationMode: Type.Optional(
      Type.Union([
        Type.Literal("sequential"),
        Type.Literal("conditional"),
        Type.Literal("fan_out"),
        Type.Literal("fan_in"),
      ]),
    ),
    activationWhen: Type.Optional(Type.String()),
    activationFromStepIds: Type.Optional(Type.Array(Type.String())),
    terminalOnSuccess: Type.Optional(Type.Boolean()),
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("running"),
      Type.Literal("waiting"),
      Type.Literal("skipped"),
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
    executor: Type.Optional(
      Type.Union([Type.Literal("n8n"), Type.Literal("crawclaw_agent"), Type.Literal("n8n_wait")]),
    ),
    startedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    updatedAt: Type.Integer({ minimum: 0 }),
    endedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    summary: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    skippedReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkflowExecutionEventRecordSchema = Type.Object(
  {
    at: Type.Integer({ minimum: 0 }),
    level: Type.Union([Type.Literal("info"), Type.Literal("warn"), Type.Literal("error")]),
    type: NonEmptyString,
    message: Type.String(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

export const WorkflowExecutionWaitStateSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("input"), Type.Literal("external")]),
    prompt: Type.Optional(Type.String()),
    resumeUrl: Type.Optional(Type.String()),
    canResume: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const WorkflowExecutionViewSchema = Type.Object(
  {
    executionId: NonEmptyString,
    localExecutionId: Type.Optional(Type.String()),
    n8nExecutionId: Type.Optional(Type.String()),
    workflowId: Type.Optional(Type.String()),
    workflowName: Type.Optional(Type.String()),
    n8nWorkflowId: Type.Optional(Type.String()),
    status: Type.Union([
      Type.Literal("queued"),
      Type.Literal("running"),
      Type.Literal("waiting_input"),
      Type.Literal("waiting_external"),
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("cancelled"),
    ]),
    currentStepId: Type.Optional(Type.String()),
    currentExecutor: Type.Optional(
      Type.Union([Type.Literal("n8n"), Type.Literal("crawclaw_agent"), Type.Literal("n8n_wait")]),
    ),
    remoteStatus: Type.Optional(Type.String()),
    remoteFinished: Type.Optional(Type.Boolean()),
    startedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    updatedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    endedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    steps: Type.Optional(Type.Array(WorkflowExecutionStepRecordSchema)),
    events: Type.Optional(Type.Array(WorkflowExecutionEventRecordSchema)),
    waiting: Type.Optional(WorkflowExecutionWaitStateSchema),
    source: Type.Union([Type.Literal("local"), Type.Literal("local+n8n"), Type.Literal("n8n")]),
  },
  { additionalProperties: false },
);

export const WorkflowListEntrySchema = Type.Object(
  {
    ...WorkflowRegistryEntrySchema.properties,
    runCount: Type.Integer({ minimum: 0 }),
    recentExecution: Type.Union([WorkflowExecutionViewSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const WorkflowDefinitionDiffSchema = Type.Object(
  {
    summary: Type.Object(
      {
        basicChanged: Type.Boolean(),
        inputsChanged: Type.Boolean(),
        outputsChanged: Type.Boolean(),
        policyChanged: Type.Boolean(),
        stepsAdded: Type.Integer({ minimum: 0 }),
        stepsRemoved: Type.Integer({ minimum: 0 }),
        stepsUpdated: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    changes: Type.Object(
      {
        basic: Type.Array(
          Type.Object(
            {
              field: NonEmptyString,
              before: Type.Optional(Type.Unknown()),
              after: Type.Optional(Type.Unknown()),
            },
            { additionalProperties: false },
          ),
        ),
        inputs: Type.Array(
          Type.Object(
            {
              field: NonEmptyString,
              before: Type.Optional(Type.Unknown()),
              after: Type.Optional(Type.Unknown()),
            },
            { additionalProperties: false },
          ),
        ),
        outputs: Type.Array(
          Type.Object(
            {
              field: NonEmptyString,
              before: Type.Optional(Type.Unknown()),
              after: Type.Optional(Type.Unknown()),
            },
            { additionalProperties: false },
          ),
        ),
        policy: Type.Array(
          Type.Object(
            {
              field: NonEmptyString,
              before: Type.Optional(Type.Unknown()),
              after: Type.Optional(Type.Unknown()),
            },
            { additionalProperties: false },
          ),
        ),
        steps: Type.Array(
          Type.Object(
            {
              stepId: NonEmptyString,
              change: Type.Union([
                Type.Literal("added"),
                Type.Literal("removed"),
                Type.Literal("updated"),
              ]),
              before: Type.Optional(WorkflowStepSpecSchema),
              after: Type.Optional(WorkflowStepSpecSchema),
              fields: Type.Optional(
                Type.Array(
                  Type.Object(
                    {
                      field: NonEmptyString,
                      before: Type.Optional(Type.Unknown()),
                      after: Type.Optional(Type.Unknown()),
                    },
                    { additionalProperties: false },
                  ),
                ),
              ),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const WorkflowVersionSummarySchema = Type.Object(
  {
    workflowId: NonEmptyString,
    specVersion: Type.Integer({ minimum: 1 }),
    savedAt: Type.Integer({ minimum: 0 }),
    savedBySessionKey: Type.Optional(Type.String()),
    reason: NonEmptyString,
    name: NonEmptyString,
    goal: NonEmptyString,
    topology: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkflowDeploymentRecordSchema = Type.Object(
  {
    workflowId: NonEmptyString,
    deploymentVersion: Type.Integer({ minimum: 0 }),
    specVersion: Type.Integer({ minimum: 0 }),
    n8nWorkflowId: NonEmptyString,
    publishedAt: Type.Integer({ minimum: 0 }),
    publishedBySessionKey: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WorkflowListParamsSchema = defineWorkflowContextParamsSchema({
  includeDisabled: Type.Optional(Type.Boolean()),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const WorkflowListResultSchema = Type.Object(
  {
    agentId: Type.Optional(Type.String()),
    count: Type.Integer({ minimum: 0 }),
    workflows: Type.Array(WorkflowListEntrySchema),
  },
  { additionalProperties: false },
);

export const WorkflowGetParamsSchema = defineWorkflowContextParamsSchema({
  workflow: NonEmptyString,
  recentRunsLimit: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const WorkflowGetResultSchema = Type.Object(
  {
    agentId: Type.Optional(Type.String()),
    workflow: WorkflowRegistryEntrySchema,
    spec: WorkflowSpecSchema,
    specPath: NonEmptyString,
    storeRoot: NonEmptyString,
    recentExecutions: Type.Array(WorkflowExecutionViewSchema),
  },
  { additionalProperties: false },
);

export const WorkflowMatchParamsSchema = defineWorkflowContextParamsSchema({
  query: NonEmptyString,
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
  enabledOnly: Type.Optional(Type.Boolean()),
  deployedOnly: Type.Optional(Type.Boolean()),
  autoRunnableOnly: Type.Optional(Type.Boolean()),
});

export const WorkflowVersionsParamsSchema = defineWorkflowContextParamsSchema({
  workflow: NonEmptyString,
});

export const WorkflowVersionsResultSchema = Type.Object(
  {
    agentId: Type.Optional(Type.String()),
    workflow: WorkflowRegistryEntrySchema,
    specVersions: Type.Array(WorkflowVersionSummarySchema),
    deployments: Type.Array(WorkflowDeploymentRecordSchema),
    currentDeployment: Type.Union([WorkflowDeploymentRecordSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const WorkflowDiffParamsSchema = defineWorkflowContextParamsSchema({
  workflow: NonEmptyString,
  specVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  toSpecVersion: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const WorkflowDiffResultSchema = Type.Object(
  {
    agentId: Type.Optional(Type.String()),
    workflow: Type.Object(
      {
        workflowId: NonEmptyString,
        name: NonEmptyString,
      },
      { additionalProperties: false },
    ),
    fromSpecVersion: Type.Integer({ minimum: 1 }),
    toSpecVersion: Type.Integer({ minimum: 1 }),
    diff: WorkflowDefinitionDiffSchema,
  },
  { additionalProperties: false },
);

export const WorkflowUpdateParamsSchema = defineWorkflowContextParamsSchema({
  workflow: NonEmptyString,
  patch: Type.Record(Type.String(), Type.Unknown()),
});

export const WorkflowRunsParamsSchema = defineWorkflowContextParamsSchema({
  workflow: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const WorkflowRunsResultSchema = Type.Object(
  {
    agentId: Type.Optional(Type.String()),
    count: Type.Integer({ minimum: 0 }),
    executions: Type.Array(WorkflowExecutionViewSchema),
  },
  { additionalProperties: false },
);

export const N8nWorkflowRecordSchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    active: Type.Optional(Type.Boolean()),
    nodes: Type.Array(Type.Record(Type.String(), Type.Unknown())),
    connections: Type.Record(Type.String(), Type.Unknown()),
    settings: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    staticData: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    meta: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    createdAt: Type.Optional(Type.String()),
    updatedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export const N8nExecutionRecordSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    executionId: Type.Optional(Type.String()),
    workflowId: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    finished: Type.Optional(Type.Boolean()),
    stoppedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    startedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
);

export const WorkflowN8nGetParamsSchema = defineWorkflowContextParamsSchema({
  workflow: NonEmptyString,
  executionsLimit: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const WorkflowN8nGetResultSchema = Type.Object(
  {
    agentId: Type.Optional(Type.String()),
    workflow: WorkflowRegistryEntrySchema,
    remoteWorkflow: N8nWorkflowRecordSchema,
    remoteExecutions: Type.Array(N8nExecutionRecordSchema),
    remoteWorkflowUrl: NonEmptyString,
    remoteExecutionsUrl: NonEmptyString,
  },
  { additionalProperties: false },
);

export const WorkflowMutationParamsSchema = defineWorkflowContextParamsSchema({
  workflow: NonEmptyString,
});

export const WorkflowMutationResultSchema = Type.Object(
  {
    agentId: Type.Optional(Type.String()),
    workflow: WorkflowRegistryEntrySchema,
  },
  { additionalProperties: false },
);

export const WorkflowDeleteParamsSchema = WorkflowMutationParamsSchema;

export const WorkflowDeleteResultSchema = Type.Object(
  {
    agentId: Type.Optional(Type.String()),
    deleted: Type.Boolean(),
    workflowId: Type.Optional(Type.String()),
    removedExecutions: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const WorkflowDeployParamsSchema = WorkflowMutationParamsSchema;

export const WorkflowRepublishParamsSchema = defineWorkflowContextParamsSchema({
  workflow: NonEmptyString,
  summary: Type.Optional(Type.String()),
});

export const WorkflowRollbackParamsSchema = defineWorkflowContextParamsSchema({
  workflow: NonEmptyString,
  specVersion: Type.Integer({ minimum: 1 }),
  republish: Type.Optional(Type.Boolean()),
  summary: Type.Optional(Type.String()),
});

export const WorkflowRunParamsSchema = defineWorkflowContextParamsSchema({
  workflow: NonEmptyString,
  inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  approved: Type.Optional(Type.Boolean()),
});

export const WorkflowExecutionControlParamsSchema = defineWorkflowContextParamsSchema({
  executionId: NonEmptyString,
});

export const WorkflowExecutionActionResultSchema = Type.Object(
  {
    agentId: Type.Optional(Type.String()),
    workflow: Type.Optional(WorkflowRegistryEntrySchema),
    execution: WorkflowExecutionViewSchema,
  },
  { additionalProperties: false },
);

export const WorkflowResumeParamsSchema = defineWorkflowContextParamsSchema({
  executionId: NonEmptyString,
  input: Type.Optional(Type.String()),
});
