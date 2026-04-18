import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const UsageWindowSchema = Type.Object(
  {
    label: NonEmptyString,
    usedPercent: Type.Number(),
    resetAt: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ProviderUsageSnapshotSchema = Type.Object(
  {
    provider: Type.Union([
      Type.Literal("anthropic"),
      Type.Literal("github-copilot"),
      Type.Literal("google-gemini-cli"),
      Type.Literal("minimax"),
      Type.Literal("openai-codex"),
      Type.Literal("xiaomi"),
      Type.Literal("zai"),
    ]),
    displayName: NonEmptyString,
    windows: Type.Array(UsageWindowSchema),
    plan: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const UsageStatusResultSchema = Type.Object(
  {
    updatedAt: Type.Integer({ minimum: 0 }),
    providers: Type.Array(ProviderUsageSnapshotSchema),
  },
  { additionalProperties: false },
);

export const UsageCostParamsSchema = Type.Object(
  {
    startDate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    endDate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
    days: Type.Optional(Type.Integer({ minimum: 1 })),
    mode: Type.Optional(
      Type.Union([Type.Literal("utc"), Type.Literal("gateway"), Type.Literal("specific")]),
    ),
    utcOffset: Type.Optional(Type.String({ pattern: "^UTC[+-]\\d{1,2}(?::[0-5]\\d)?$" })),
  },
  { additionalProperties: false },
);

export const CostUsageTotalsSchema = Type.Object(
  {
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
    totalTokens: Type.Number(),
    totalCost: Type.Number(),
    inputCost: Type.Number(),
    outputCost: Type.Number(),
    cacheReadCost: Type.Number(),
    cacheWriteCost: Type.Number(),
    missingCostEntries: Type.Number(),
  },
  { additionalProperties: false },
);

export const CostUsageDailyEntrySchema = Type.Object(
  {
    ...CostUsageTotalsSchema.properties,
    date: NonEmptyString,
  },
  { additionalProperties: false },
);

export const CostUsageSummarySchema = Type.Object(
  {
    updatedAt: Type.Integer({ minimum: 0 }),
    days: Type.Integer({ minimum: 0 }),
    daily: Type.Array(CostUsageDailyEntrySchema),
    totals: CostUsageTotalsSchema,
  },
  { additionalProperties: false },
);

export const SessionOriginSchema = Type.Object(
  {
    label: Type.Optional(Type.String()),
    provider: Type.Optional(Type.String()),
    surface: Type.Optional(Type.String()),
    chatType: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
    to: Type.Optional(Type.String()),
    accountId: Type.Optional(Type.String()),
    threadId: Type.Optional(Type.Union([Type.String(), Type.Integer()])),
  },
  { additionalProperties: false },
);

export const SessionMessageCountsSchema = Type.Object(
  {
    total: Type.Number(),
    user: Type.Number(),
    assistant: Type.Number(),
    toolCalls: Type.Number(),
    toolResults: Type.Number(),
    errors: Type.Number(),
  },
  { additionalProperties: false },
);

export const SessionToolUsageSchema = Type.Object(
  {
    totalCalls: Type.Number(),
    uniqueTools: Type.Number(),
    tools: Type.Array(
      Type.Object(
        {
          name: NonEmptyString,
          count: Type.Number(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const SessionModelUsageSchema = Type.Object(
  {
    provider: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    count: Type.Number(),
    totals: CostUsageTotalsSchema,
  },
  { additionalProperties: false },
);

export const SessionLatencyStatsSchema = Type.Object(
  {
    count: Type.Number(),
    avgMs: Type.Number(),
    p95Ms: Type.Number(),
    minMs: Type.Number(),
    maxMs: Type.Number(),
  },
  { additionalProperties: false },
);

export const SessionDailyLatencySchema = Type.Object(
  {
    ...SessionLatencyStatsSchema.properties,
    date: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SessionDailyModelUsageSchema = Type.Object(
  {
    date: NonEmptyString,
    provider: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    tokens: Type.Number(),
    cost: Type.Number(),
    count: Type.Number(),
  },
  { additionalProperties: false },
);

export const SessionUsageEntrySchema = Type.Object(
  {
    key: NonEmptyString,
    label: Type.Optional(Type.String()),
    sessionId: Type.Optional(Type.String()),
    updatedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    agentId: Type.Optional(Type.String()),
    channel: Type.Optional(Type.String()),
    chatType: Type.Optional(Type.String()),
    origin: Type.Optional(SessionOriginSchema),
    modelOverride: Type.Optional(Type.String()),
    providerOverride: Type.Optional(Type.String()),
    modelProvider: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    usage: Type.Union([
      Type.Object(
        {
          ...CostUsageTotalsSchema.properties,
          sessionId: Type.Optional(Type.String()),
          sessionFile: Type.Optional(Type.String()),
          firstActivity: Type.Optional(Type.Integer({ minimum: 0 })),
          lastActivity: Type.Optional(Type.Integer({ minimum: 0 })),
          durationMs: Type.Optional(Type.Number()),
          activityDates: Type.Optional(Type.Array(NonEmptyString)),
          dailyBreakdown: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  date: NonEmptyString,
                  tokens: Type.Number(),
                  cost: Type.Number(),
                },
                { additionalProperties: false },
              ),
            ),
          ),
          dailyMessageCounts: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  date: NonEmptyString,
                  total: Type.Number(),
                  user: Type.Number(),
                  assistant: Type.Number(),
                  toolCalls: Type.Number(),
                  toolResults: Type.Number(),
                  errors: Type.Number(),
                },
                { additionalProperties: false },
              ),
            ),
          ),
          dailyLatency: Type.Optional(Type.Array(SessionDailyLatencySchema)),
          dailyModelUsage: Type.Optional(Type.Array(SessionDailyModelUsageSchema)),
          messageCounts: Type.Optional(SessionMessageCountsSchema),
          toolUsage: Type.Optional(SessionToolUsageSchema),
          modelUsage: Type.Optional(Type.Array(SessionModelUsageSchema)),
          latency: Type.Optional(SessionLatencyStatsSchema),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    contextWeight: Type.Optional(
      Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

export const SessionsUsageAggregatesSchema = Type.Object(
  {
    messages: SessionMessageCountsSchema,
    tools: SessionToolUsageSchema,
    byModel: Type.Array(SessionModelUsageSchema),
    byProvider: Type.Array(SessionModelUsageSchema),
    byAgent: Type.Array(
      Type.Object(
        {
          agentId: NonEmptyString,
          totals: CostUsageTotalsSchema,
        },
        { additionalProperties: false },
      ),
    ),
    byChannel: Type.Array(
      Type.Object(
        {
          channel: NonEmptyString,
          totals: CostUsageTotalsSchema,
        },
        { additionalProperties: false },
      ),
    ),
    latency: Type.Optional(SessionLatencyStatsSchema),
    dailyLatency: Type.Optional(Type.Array(SessionDailyLatencySchema)),
    modelDaily: Type.Optional(Type.Array(SessionDailyModelUsageSchema)),
    daily: Type.Array(
      Type.Object(
        {
          date: NonEmptyString,
          tokens: Type.Number(),
          cost: Type.Number(),
          messages: Type.Number(),
          toolCalls: Type.Number(),
          errors: Type.Number(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const SessionsUsageResultSchema = Type.Object(
  {
    updatedAt: Type.Integer({ minimum: 0 }),
    startDate: NonEmptyString,
    endDate: NonEmptyString,
    sessions: Type.Array(SessionUsageEntrySchema),
    totals: CostUsageTotalsSchema,
    aggregates: SessionsUsageAggregatesSchema,
  },
  { additionalProperties: false },
);

export const SessionsUsageTimeSeriesParamsSchema = Type.Object(
  {
    key: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SessionUsageTimePointSchema = Type.Object(
  {
    timestamp: Type.Integer({ minimum: 0 }),
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
    totalTokens: Type.Number(),
    cost: Type.Number(),
    cumulativeTokens: Type.Number(),
    cumulativeCost: Type.Number(),
  },
  { additionalProperties: false },
);

export const SessionsUsageTimeSeriesResultSchema = Type.Object(
  {
    sessionId: Type.Optional(Type.String()),
    points: Type.Array(SessionUsageTimePointSchema),
  },
  { additionalProperties: false },
);

export const SessionsUsageLogsParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const SessionLogEntrySchema = Type.Object(
  {
    timestamp: Type.Integer({ minimum: 0 }),
    role: Type.Union([
      Type.Literal("user"),
      Type.Literal("assistant"),
      Type.Literal("tool"),
      Type.Literal("toolResult"),
    ]),
    content: Type.String(),
    tokens: Type.Optional(Type.Number()),
    cost: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

export const SessionsUsageLogsResultSchema = Type.Object(
  {
    logs: Type.Array(SessionLogEntrySchema),
  },
  { additionalProperties: false },
);
