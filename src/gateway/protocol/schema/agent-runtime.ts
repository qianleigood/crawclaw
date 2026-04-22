import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableNumber = Type.Union([Type.Number(), Type.Null()]);

export const AgentRuntimeCategorySchema = Type.Union([
  Type.Literal("memory"),
  Type.Literal("verification"),
  Type.Literal("subagents"),
  Type.Literal("acp"),
  Type.Literal("cron"),
  Type.Literal("cli"),
]);

export const AgentRuntimeCategoryFilterSchema = Type.Union([
  Type.Literal("all"),
  AgentRuntimeCategorySchema,
]);

export const AgentRuntimeStatusFilterSchema = Type.Union([
  Type.Literal("all"),
  Type.Literal("running"),
  Type.Literal("failed"),
  Type.Literal("waiting"),
  Type.Literal("completed"),
  Type.Literal("attention"),
]);

export const AgentRuntimeSummaryParamsSchema = Type.Object(
  {
    category: Type.Optional(AgentRuntimeCategoryFilterSchema),
    status: Type.Optional(AgentRuntimeStatusFilterSchema),
    agent: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    taskId: Type.Optional(Type.String()),
    runId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AgentRuntimeListParamsSchema = Type.Object(
  {
    ...AgentRuntimeSummaryParamsSchema.properties,
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const AgentRuntimeGetParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AgentRuntimeCancelParamsSchema = Type.Object(
  {
    taskId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AgentRuntimeSummaryResultSchema = Type.Object(
  {
    running: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
    waiting: Type.Integer({ minimum: 0 }),
    completed: Type.Integer({ minimum: 0 }),
    lastCompletedAt: NullableString,
    byCategory: Type.Object(
      {
        memory: Type.Integer({ minimum: 0 }),
        verification: Type.Integer({ minimum: 0 }),
        subagents: Type.Integer({ minimum: 0 }),
        acp: Type.Integer({ minimum: 0 }),
        cron: Type.Integer({ minimum: 0 }),
        cli: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const AgentRuntimeRunSchema = Type.Object(
  {
    taskId: NonEmptyString,
    category: AgentRuntimeCategorySchema,
    runtime: Type.String(),
    status: Type.String(),
    title: Type.String(),
    summary: NullableString,
    sessionKey: NonEmptyString,
    ownerKey: Type.String(),
    scopeKind: Type.String(),
    childSessionKey: NullableString,
    agentId: NullableString,
    runId: NullableString,
    parentTaskId: NullableString,
    sourceId: NullableString,
    spawnSource: NullableString,
    progressSummary: NullableString,
    terminalSummary: NullableString,
    error: NullableString,
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
    startedAt: NullableNumber,
    endedAt: NullableNumber,
  },
  { additionalProperties: false },
);

export const AgentRuntimeListResultSchema = Type.Object(
  {
    summary: AgentRuntimeSummaryResultSchema,
    count: Type.Integer({ minimum: 0 }),
    runs: Type.Array(AgentRuntimeRunSchema),
  },
  { additionalProperties: false },
);

export const AgentRuntimeContractSchema = Type.Object(
  {
    definitionId: NullableString,
    definitionLabel: NullableString,
    spawnSource: NullableString,
    executionMode: NullableString,
    transcriptPolicy: NullableString,
    cleanup: NullableString,
    sandbox: NullableString,
    defaultRunTimeoutSeconds: NullableNumber,
    toolAllowlistCount: NullableNumber,
  },
  { additionalProperties: false },
);

export const AgentRuntimeMetadataSchema = Type.Object(
  {
    mode: NullableString,
    runtimeStateRef: NullableString,
    transcriptRef: NullableString,
    trajectoryRef: NullableString,
    capabilitySnapshotRef: NullableString,
  },
  { additionalProperties: false },
);

export const AgentRuntimeAvailableActionsSchema = Type.Object(
  {
    openSession: Type.Boolean(),
    cancel: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AgentRuntimeDetailResultSchema = Type.Object(
  {
    run: AgentRuntimeRunSchema,
    contract: AgentRuntimeContractSchema,
    metadata: AgentRuntimeMetadataSchema,
    availableActions: AgentRuntimeAvailableActionsSchema,
  },
  { additionalProperties: false },
);

export const AgentRuntimeCancelResultSchema = Type.Object(
  {
    found: Type.Boolean(),
    cancelled: Type.Boolean(),
    reason: Type.Optional(NullableString),
    task: Type.Optional(AgentRuntimeRunSchema),
  },
  { additionalProperties: false },
);
