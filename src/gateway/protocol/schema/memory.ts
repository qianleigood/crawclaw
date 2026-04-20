import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const NullableString = Type.Union([Type.String(), Type.Null()]);

const MemoryModeSchema = Type.Union([Type.Literal("query"), Type.Literal("write")]);

export const MemoryStatusParamsSchema = Type.Object(
  {
    mode: Type.Optional(MemoryModeSchema),
  },
  { additionalProperties: false },
);

export const MemoryRefreshParamsSchema = MemoryStatusParamsSchema;

export const MemoryProviderStatusSchema = Type.Object(
  {
    provider: Type.Literal("notebooklm"),
    enabled: Type.Boolean(),
    ready: Type.Boolean(),
    lifecycle: Type.Union([
      Type.Literal("ready"),
      Type.Literal("degraded"),
      Type.Literal("refreshing"),
      Type.Literal("expired"),
    ]),
    reason: NullableString,
    recommendedAction: NullableString,
    profile: Type.String(),
    notebookId: NullableString,
    refreshAttempted: Type.Boolean(),
    refreshSucceeded: Type.Boolean(),
    authSource: NullableString,
    lastValidatedAt: Type.String(),
    lastRefreshAt: NullableString,
    nextProbeAt: NullableString,
    nextAllowedRefreshAt: NullableString,
    details: NullableString,
  },
  { additionalProperties: false },
);

export const MemoryLoginParamsSchema = Type.Object(
  {
    interactive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const MemoryLoginResultSchema = Type.Object(
  {
    started: Type.Boolean(),
    status: Type.Union([
      Type.Literal("started"),
      Type.Literal("completed"),
      Type.Literal("failed"),
    ]),
    command: Type.Optional(NullableString),
    message: Type.Optional(NullableString),
    providerState: Type.Optional(MemoryProviderStatusSchema),
  },
  { additionalProperties: false },
);

export const MemoryScopeParamsSchema = Type.Object(
  {
    agent: Type.Optional(Type.String()),
    channel: Type.Optional(Type.String()),
    user: Type.Optional(Type.String()),
    scopeKey: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryDreamStatusParamsSchema = Type.Object(
  {
    ...MemoryScopeParamsSchema.properties,
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const MemoryDreamRunParamsSchema = Type.Object(
  {
    ...MemoryScopeParamsSchema.properties,
    force: Type.Optional(Type.Boolean()),
    dryRun: Type.Optional(Type.Boolean()),
    sessionLimit: Type.Optional(Type.Integer({ minimum: 1 })),
    signalLimit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const MemoryDreamRunPreviewSchema = Type.Object(
  {
    scopeKey: NonEmptyString,
    recentSessionCount: Type.Integer({ minimum: 0 }),
    recentSignalCount: Type.Integer({ minimum: 0 }),
    recentSessionIds: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const MemoryDreamRunResultSchema = Type.Object(
  {
    status: Type.String(),
    reason: Type.Optional(NullableString),
    runId: Type.Optional(NullableString),
    preview: Type.Optional(MemoryDreamRunPreviewSchema),
  },
  { additionalProperties: false },
);

export const MemoryDreamStateSchema = Type.Object(
  {
    lastSuccessAt: Type.Optional(NullableString),
    lastAttemptAt: Type.Optional(NullableString),
    lastFailureAt: Type.Optional(NullableString),
    lastSkipReason: Type.Optional(NullableString),
    lockOwner: Type.Optional(NullableString),
  },
  { additionalProperties: false },
);

export const MemoryDreamRunEntrySchema = Type.Object(
  {
    kind: Type.Optional(Type.String()),
    runId: Type.Optional(NullableString),
    status: Type.String(),
    scope: Type.Optional(NullableString),
    triggerSource: Type.Optional(NullableString),
    summary: Type.Optional(NullableString),
    error: Type.Optional(NullableString),
    createdAt: Type.Optional(NullableString),
  },
  { additionalProperties: true },
);

export const MemoryDreamStatusResultSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    config: Type.Object(
      {
        minHours: Type.Number(),
        minSessions: Type.Integer({ minimum: 0 }),
        scanThrottleMs: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: true },
    ),
    scopeKey: NullableString,
    state: Type.Union([MemoryDreamStateSchema, Type.Null()]),
    runs: Type.Array(MemoryDreamRunEntrySchema),
  },
  { additionalProperties: false },
);

export const MemoryDreamHistoryResultSchema = Type.Object(
  {
    scopeKey: NullableString,
    runs: Type.Array(MemoryDreamRunEntrySchema),
  },
  { additionalProperties: false },
);

export const MemorySessionSummaryStatusParamsSchema = Type.Object(
  {
    agent: Type.Optional(Type.String()),
    sessionId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const MemorySessionSummaryRefreshParamsSchema = Type.Object(
  {
    agent: Type.Optional(Type.String()),
    sessionId: NonEmptyString,
    sessionKey: NonEmptyString,
    force: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const MemorySessionSummaryStateSchema = Type.Object(
  {
    lastSummarizedMessageId: Type.Optional(NullableString),
    lastSummaryUpdatedAt: Type.Optional(NullableString),
    tokensAtLastSummary: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    summaryInProgress: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const MemorySessionSummarySectionsSchema = Type.Object(
  {
    currentState: Type.String(),
    openLoops: Type.String(),
    taskSpecification: Type.String(),
    keyResults: Type.String(),
    errorsAndCorrections: Type.String(),
  },
  { additionalProperties: false },
);

export const MemorySessionSummaryPromotionSchema = Type.Object(
  {
    total: Type.Number(),
    pending: Type.Number(),
    approved: Type.Number(),
    written: Type.Number(),
    failed: Type.Number(),
    latestCreatedAt: Type.Union([Type.Number(), Type.Null()]),
    latestUpdatedAt: Type.Union([Type.Number(), Type.Null()]),
    latestTitles: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const MemorySessionSummaryStatusResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    sessionId: NonEmptyString,
    summaryPath: NonEmptyString,
    exists: Type.Boolean(),
    updatedAt: NullableString,
    profile: Type.Union([Type.Literal("light"), Type.Literal("full"), Type.Null()]),
    promotion: MemorySessionSummaryPromotionSchema,
    state: Type.Union([MemorySessionSummaryStateSchema, Type.Null()]),
    sections: MemorySessionSummarySectionsSchema,
  },
  { additionalProperties: false },
);

export const MemorySessionSummaryRefreshResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    sessionId: NonEmptyString,
    sessionKey: NonEmptyString,
    result: Type.Object(
      {
        status: Type.String(),
        reason: Type.Optional(NullableString),
        runId: Type.Optional(NullableString),
        promotion: Type.Optional(
          Type.Object(
            {
              created: Type.Number(),
              updated: Type.Number(),
              candidateIds: Type.Array(Type.String()),
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

export const MemoryPromptJournalSummaryParamsSchema = Type.Object(
  {
    file: Type.Optional(Type.String()),
    dir: Type.Optional(Type.String()),
    date: Type.Optional(Type.String()),
    days: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const MemoryPromptJournalSummaryResultSchema = Type.Object(
  {
    files: Type.Array(Type.String()),
    dateBuckets: Type.Array(Type.String()),
    totalEvents: Type.Integer({ minimum: 0 }),
    stageCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
    uniqueSessions: Type.Integer({ minimum: 0 }),
    promptAssembly: Type.Object(
      {
        count: Type.Integer({ minimum: 0 }),
        avgEstimatedTokens: Type.Union([Type.Number(), Type.Null()]),
        avgSystemPromptChars: Type.Union([Type.Number(), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    afterTurn: Type.Object(
      {
        decisionCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
        skipReasonCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
      },
      { additionalProperties: false },
    ),
    durableExtraction: Type.Object(
      {
        count: Type.Integer({ minimum: 0 }),
        notesSavedTotal: Type.Integer({ minimum: 0 }),
        nonZeroSaveCount: Type.Integer({ minimum: 0 }),
        zeroSaveCount: Type.Integer({ minimum: 0 }),
        saveRate: Type.Union([Type.Number(), Type.Null()]),
        topReasons: Type.Array(
          Type.Object(
            {
              reason: Type.String(),
              count: Type.Integer({ minimum: 0 }),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    knowledgeWrite: Type.Object(
      {
        statusCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
        actionCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
        titles: Type.Array(
          Type.Object(
            {
              title: Type.String(),
              count: Type.Integer({ minimum: 0 }),
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
