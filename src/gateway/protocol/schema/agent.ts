import { Type } from "@sinclair/typebox";
import { InputProvenanceSchema, NonEmptyString, SessionLabelString } from "./primitives.js";

const ObservationRefValueSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);

export const ObservationTraceContextSchema = Type.Object(
  {
    traceId: NonEmptyString,
    spanId: NonEmptyString,
    parentSpanId: Type.Union([Type.String(), Type.Null()]),
    traceparent: Type.Optional(Type.String()),
    tracestate: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ObservationRuntimeContextSchema = Type.Object(
  {
    runId: Type.Optional(Type.String()),
    sessionId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    agentId: Type.Optional(Type.String()),
    parentAgentId: Type.Optional(Type.String()),
    taskId: Type.Optional(Type.String()),
    workflowRunId: Type.Optional(Type.String()),
    workflowStepId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ObservationContextSchema = Type.Object(
  {
    trace: ObservationTraceContextSchema,
    runtime: ObservationRuntimeContextSchema,
    phase: Type.Optional(Type.String()),
    decisionCode: Type.Optional(Type.String()),
    source: NonEmptyString,
    refs: Type.Optional(Type.Record(Type.String(), ObservationRefValueSchema)),
  },
  { additionalProperties: false },
);

export const ObservationRefSchema = Type.Object(
  {
    traceId: NonEmptyString,
    spanId: NonEmptyString,
    parentSpanId: Type.Union([Type.String(), Type.Null()]),
    runId: Type.Optional(Type.String()),
    sessionId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    agentId: Type.Optional(Type.String()),
    taskId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AgentInternalEventSchema = Type.Object(
  {
    type: Type.Literal("task_completion"),
    source: Type.String({ enum: ["subagent", "cron"] }),
    childSessionKey: Type.String(),
    childSessionId: Type.Optional(Type.String()),
    announceType: Type.String(),
    taskLabel: Type.String(),
    status: Type.String({ enum: ["ok", "timeout", "error", "unknown"] }),
    statusLabel: Type.String(),
    result: Type.String(),
    statsLine: Type.Optional(Type.String()),
    replyInstruction: Type.String(),
  },
  { additionalProperties: false },
);

export const AgentEventSchema = Type.Object(
  {
    runId: NonEmptyString,
    seq: Type.Integer({ minimum: 0 }),
    stream: NonEmptyString,
    ts: Type.Integer({ minimum: 0 }),
    data: Type.Record(Type.String(), Type.Unknown()),
    observationRef: Type.Optional(ObservationRefSchema),
  },
  { additionalProperties: false },
);

export const SendParamsSchema = Type.Object(
  {
    to: NonEmptyString,
    message: Type.Optional(Type.String()),
    mediaUrl: Type.Optional(Type.String()),
    mediaUrls: Type.Optional(Type.Array(Type.String())),
    gifPlayback: Type.Optional(Type.Boolean()),
    channel: Type.Optional(Type.String()),
    accountId: Type.Optional(Type.String()),
    /** Optional agent id for per-agent media root resolution on gateway sends. */
    agentId: Type.Optional(Type.String()),
    /** Thread id (channel-specific meaning, e.g. Telegram forum topic id). */
    threadId: Type.Optional(Type.String()),
    /** Optional session key for mirroring delivered output back into the transcript. */
    sessionKey: Type.Optional(Type.String()),
    idempotencyKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const PollParamsSchema = Type.Object(
  {
    to: NonEmptyString,
    question: NonEmptyString,
    options: Type.Array(NonEmptyString, { minItems: 2, maxItems: 12 }),
    maxSelections: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
    /** Poll duration in seconds (channel-specific limits may apply). */
    durationSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 604_800 })),
    durationHours: Type.Optional(Type.Integer({ minimum: 1 })),
    /** Send silently (no notification) where supported. */
    silent: Type.Optional(Type.Boolean()),
    /** Poll anonymity where supported (e.g. Telegram polls default to anonymous). */
    isAnonymous: Type.Optional(Type.Boolean()),
    /** Thread id (channel-specific meaning, e.g. Telegram forum topic id). */
    threadId: Type.Optional(Type.String()),
    channel: Type.Optional(Type.String()),
    accountId: Type.Optional(Type.String()),
    idempotencyKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AgentParamsSchema = Type.Object(
  {
    message: NonEmptyString,
    agentId: Type.Optional(NonEmptyString),
    provider: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    replyTo: Type.Optional(Type.String()),
    sessionId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    thinking: Type.Optional(Type.String()),
    deliver: Type.Optional(Type.Boolean()),
    attachments: Type.Optional(Type.Array(Type.Unknown())),
    channel: Type.Optional(Type.String()),
    replyChannel: Type.Optional(Type.String()),
    accountId: Type.Optional(Type.String()),
    replyAccountId: Type.Optional(Type.String()),
    threadId: Type.Optional(Type.String()),
    groupId: Type.Optional(Type.String()),
    groupChannel: Type.Optional(Type.String()),
    groupSpace: Type.Optional(Type.String()),
    timeout: Type.Optional(Type.Integer({ minimum: 0 })),
    maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
    bestEffortDeliver: Type.Optional(Type.Boolean()),
    toolsAllow: Type.Optional(Type.Array(Type.String())),
    skillsAllow: Type.Optional(Type.Array(Type.String())),
    lane: Type.Optional(Type.String()),
    extraSystemPrompt: Type.Optional(Type.String()),
    internalEvents: Type.Optional(Type.Array(AgentInternalEventSchema)),
    inputProvenance: Type.Optional(InputProvenanceSchema),
    observation: Type.Optional(ObservationContextSchema),
    traceparent: Type.Optional(Type.String()),
    tracestate: Type.Optional(Type.String()),
    streamParams: Type.Optional(
      Type.Object(
        {
          temperature: Type.Optional(Type.Number()),
          maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
          toolChoice: Type.Optional(Type.Unknown()),
          fastMode: Type.Optional(Type.Boolean()),
          cacheRetention: Type.Optional(
            Type.Union([Type.Literal("none"), Type.Literal("short"), Type.Literal("long")]),
          ),
          skipCacheWrite: Type.Optional(Type.Boolean()),
          promptCacheKey: Type.Optional(Type.String()),
          promptCacheRetention: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    idempotencyKey: NonEmptyString,
    label: Type.Optional(SessionLabelString),
  },
  { additionalProperties: false },
);

export const AgentIdentityParamsSchema = Type.Object(
  {
    agentId: Type.Optional(NonEmptyString),
    sessionKey: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AgentIdentityResultSchema = Type.Object(
  {
    agentId: NonEmptyString,
    name: Type.Optional(NonEmptyString),
    avatar: Type.Optional(NonEmptyString),
    emoji: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const AgentWaitParamsSchema = Type.Object(
  {
    runId: NonEmptyString,
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const AgentInspectParamsSchema = Type.Object(
  {
    runId: Type.Optional(Type.String()),
    taskId: Type.Optional(Type.String()),
    traceId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ObservationSourceSchema = Type.String({
  enum: ["lifecycle", "diagnostic", "action", "archive", "trajectory", "log", "otel"],
});

export const ObservationRunStatusSchema = Type.String({
  enum: ["running", "ok", "error", "timeout", "archived", "unknown"],
});

export const AgentObservationsListParamsSchema = Type.Object(
  {
    query: Type.Optional(Type.String()),
    status: Type.Optional(ObservationRunStatusSchema),
    source: Type.Optional(ObservationSourceSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    cursor: Type.Optional(Type.String()),
    from: Type.Optional(Type.Integer({ minimum: 0 })),
    to: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ObservationRunSummarySchema = Type.Object(
  {
    runId: Type.Optional(Type.String()),
    taskId: Type.Optional(Type.String()),
    traceId: NonEmptyString,
    sessionId: Type.Optional(Type.String()),
    sessionKey: Type.Optional(Type.String()),
    agentId: Type.Optional(Type.String()),
    status: ObservationRunStatusSchema,
    startedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    endedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastEventAt: Type.Optional(Type.Integer({ minimum: 0 })),
    eventCount: Type.Integer({ minimum: 0 }),
    errorCount: Type.Integer({ minimum: 0 }),
    sources: Type.Array(ObservationSourceSchema),
    summary: Type.String(),
  },
  { additionalProperties: false },
);

export const AgentObservationsListResultSchema = Type.Object(
  {
    items: Type.Array(ObservationRunSummarySchema),
    nextCursor: Type.Optional(Type.String()),
    generatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const AgentInspectionTimelineEntrySchema = Type.Object(
  {
    eventId: NonEmptyString,
    type: NonEmptyString,
    phase: Type.Optional(Type.String()),
    createdAt: Type.Integer({ minimum: 0 }),
    source: Type.Optional(
      Type.String({
        enum: ["lifecycle", "diagnostic", "action", "archive", "trajectory", "log", "otel"],
      }),
    ),
    observation: Type.Optional(ObservationContextSchema),
    traceId: Type.Optional(Type.String()),
    spanId: Type.Optional(Type.String()),
    parentSpanId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    status: Type.Optional(Type.String()),
    decisionCode: Type.Optional(Type.String()),
    decisionSummary: Type.Optional(Type.String()),
    summary: Type.String(),
    metrics: Type.Optional(Type.Record(Type.String(), Type.Number())),
    refs: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
      ),
    ),
  },
  { additionalProperties: false },
);

export const AgentInspectionSnapshotSchema = Type.Object(
  {
    lookup: Type.Object(
      {
        runId: Type.Optional(Type.String()),
        taskId: Type.Optional(Type.String()),
        traceId: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    runId: Type.Optional(Type.String()),
    taskId: Type.Optional(Type.String()),
    timeline: Type.Optional(Type.Array(AgentInspectionTimelineEntrySchema)),
    refs: Type.Object(
      {
        runtimeStateRef: Type.Optional(Type.String()),
        transcriptRef: Type.Optional(Type.String()),
        trajectoryRef: Type.Optional(Type.String()),
        capabilitySnapshotRef: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    warnings: Type.Array(Type.String()),
  },
  // Keep this schema light: the full inspection payload carries many nested runtime snapshots.
  { additionalProperties: true },
);

export const WakeParamsSchema = Type.Object(
  {
    mode: Type.Literal("now"),
    text: NonEmptyString,
  },
  { additionalProperties: false },
);
