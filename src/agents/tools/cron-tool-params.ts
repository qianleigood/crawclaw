import { Type, type TSchema } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum } from "../schema/typebox.js";

const CRON_ACTIONS = ["status", "list", "add", "update", "remove", "run", "runs", "wake"] as const;
const CRON_SCHEDULE_KINDS = ["at", "every", "cron"] as const;
const CRON_WAKE_MODES = ["now", "next-heartbeat"] as const;
const CRON_PAYLOAD_KINDS = ["systemEvent", "agentTurn"] as const;
const CRON_DELIVERY_MODES = ["none", "announce", "webhook"] as const;
const CRON_RUN_MODES = ["due", "force"] as const;

export const REMINDER_CONTEXT_MESSAGES_MAX = 10;

const CRON_FLAT_PAYLOAD_KEYS = [
  "message",
  "text",
  "model",
  "fallbacks",
  "toolsAllow",
  "thinking",
  "timeoutSeconds",
  "lightContext",
  "allowUnsafeExternalContent",
] as const;

const CRON_RECOVERABLE_OBJECT_KEYS: ReadonlySet<string> = new Set([
  "name",
  "schedule",
  "sessionTarget",
  "wakeMode",
  "payload",
  "delivery",
  "enabled",
  "description",
  "deleteAfterRun",
  "agentId",
  "sessionKey",
  "failureAlert",
  ...CRON_FLAT_PAYLOAD_KEYS,
]);

function nullableStringSchema(description: string) {
  return Type.Optional(
    Type.Unsafe<string | null>({
      type: ["string", "null"],
      description,
    }),
  );
}

function nullableStringArraySchema(description: string) {
  return Type.Optional(
    Type.Unsafe<string[] | null>({
      type: ["array", "null"],
      items: { type: "string" },
      description,
    }),
  );
}

function cronPayloadObjectSchema(params: { toolsAllow: TSchema }) {
  return Type.Object(
    {
      kind: optionalStringEnum(CRON_PAYLOAD_KINDS, { description: "Payload type" }),
      text: Type.Optional(Type.String({ description: "Message text (kind=systemEvent)" })),
      message: Type.Optional(Type.String({ description: "Agent prompt (kind=agentTurn)" })),
      model: Type.Optional(Type.String({ description: "Model override" })),
      thinking: Type.Optional(Type.String({ description: "Thinking level override" })),
      timeoutSeconds: Type.Optional(Type.Number()),
      lightContext: Type.Optional(Type.Boolean()),
      allowUnsafeExternalContent: Type.Optional(Type.Boolean()),
      fallbacks: Type.Optional(Type.Array(Type.String(), { description: "Fallback model ids" })),
      toolsAllow: params.toolsAllow,
    },
    { additionalProperties: true },
  );
}

const CronScheduleSchema = Type.Optional(
  Type.Object(
    {
      kind: optionalStringEnum(CRON_SCHEDULE_KINDS, { description: "Schedule type" }),
      at: Type.Optional(Type.String({ description: "ISO-8601 timestamp (kind=at)" })),
      everyMs: Type.Optional(Type.Number({ description: "Interval in milliseconds (kind=every)" })),
      anchorMs: Type.Optional(
        Type.Number({ description: "Optional start anchor in milliseconds (kind=every)" }),
      ),
      expr: Type.Optional(Type.String({ description: "Cron expression (kind=cron)" })),
      tz: Type.Optional(Type.String({ description: "IANA timezone (kind=cron)" })),
      staggerMs: Type.Optional(Type.Number({ description: "Random jitter in ms (kind=cron)" })),
    },
    { additionalProperties: true },
  ),
);

const CronPayloadSchema = Type.Optional(
  cronPayloadObjectSchema({
    toolsAllow: Type.Optional(Type.Array(Type.String(), { description: "Allowed tool ids" })),
  }),
);

const CronDeliverySchema = Type.Optional(
  Type.Object(
    {
      mode: optionalStringEnum(CRON_DELIVERY_MODES, { description: "Delivery mode" }),
      channel: Type.Optional(Type.String({ description: "Delivery channel" })),
      to: Type.Optional(Type.String({ description: "Delivery target" })),
      bestEffort: Type.Optional(Type.Boolean()),
      accountId: Type.Optional(Type.String({ description: "Account target for delivery" })),
      failureDestination: Type.Optional(
        Type.Object(
          {
            channel: Type.Optional(Type.String()),
            to: Type.Optional(Type.String()),
            accountId: Type.Optional(Type.String()),
            mode: optionalStringEnum(["announce", "webhook"] as const),
          },
          { additionalProperties: true },
        ),
      ),
    },
    { additionalProperties: true },
  ),
);

const CronFailureAlertSchema = Type.Optional(
  Type.Unsafe<Record<string, unknown> | false>({
    type: ["object", "boolean"],
    not: { const: true },
    properties: {
      after: Type.Optional(Type.Number({ description: "Failures before alerting" })),
      channel: Type.Optional(Type.String({ description: "Alert channel" })),
      to: Type.Optional(Type.String({ description: "Alert target" })),
      cooldownMs: Type.Optional(Type.Number({ description: "Cooldown between alerts in ms" })),
      mode: optionalStringEnum(["announce", "webhook"] as const),
      accountId: Type.Optional(Type.String()),
    },
    additionalProperties: true,
    description: "Failure alert object, or false to disable alerts for this job",
  }),
);

const CronJobObjectSchema = Type.Optional(
  Type.Object(
    {
      name: Type.Optional(Type.String({ description: "Job name" })),
      schedule: CronScheduleSchema,
      sessionTarget: Type.Optional(
        Type.String({
          description: 'Session target: "main", "isolated", "current", or "session:<id>"',
        }),
      ),
      wakeMode: optionalStringEnum(CRON_WAKE_MODES, { description: "When to wake the session" }),
      payload: CronPayloadSchema,
      delivery: CronDeliverySchema,
      agentId: nullableStringSchema("Agent id, or null to keep it unset"),
      description: Type.Optional(Type.String({ description: "Human-readable description" })),
      enabled: Type.Optional(Type.Boolean()),
      deleteAfterRun: Type.Optional(Type.Boolean({ description: "Delete after first execution" })),
      sessionKey: nullableStringSchema("Explicit session key, or null to clear it"),
      failureAlert: CronFailureAlertSchema,
    },
    { additionalProperties: true },
  ),
);

const CronPatchObjectSchema = Type.Optional(
  Type.Object(
    {
      name: Type.Optional(Type.String({ description: "Job name" })),
      schedule: Type.Optional(
        Type.Object(
          {
            kind: optionalStringEnum(CRON_SCHEDULE_KINDS, { description: "Schedule type" }),
            at: Type.Optional(Type.String({ description: "ISO-8601 timestamp (kind=at)" })),
            everyMs: Type.Optional(
              Type.Number({ description: "Interval in milliseconds (kind=every)" }),
            ),
            anchorMs: Type.Optional(
              Type.Number({ description: "Optional start anchor in milliseconds (kind=every)" }),
            ),
            expr: Type.Optional(Type.String({ description: "Cron expression (kind=cron)" })),
            tz: Type.Optional(Type.String({ description: "IANA timezone (kind=cron)" })),
            staggerMs: Type.Optional(
              Type.Number({ description: "Random jitter in ms (kind=cron)" }),
            ),
          },
          { additionalProperties: true },
        ),
      ),
      sessionTarget: Type.Optional(Type.String({ description: "Session target" })),
      wakeMode: optionalStringEnum(CRON_WAKE_MODES),
      payload: Type.Optional(
        cronPayloadObjectSchema({
          toolsAllow: nullableStringArraySchema("Allowed tool ids, or null to clear"),
        }),
      ),
      delivery: Type.Optional(
        Type.Object(
          {
            mode: optionalStringEnum(CRON_DELIVERY_MODES, { description: "Delivery mode" }),
            channel: Type.Optional(Type.String({ description: "Delivery channel" })),
            to: Type.Optional(Type.String({ description: "Delivery target" })),
            bestEffort: Type.Optional(Type.Boolean()),
            accountId: Type.Optional(Type.String({ description: "Account target for delivery" })),
            failureDestination: Type.Optional(
              Type.Object(
                {
                  channel: Type.Optional(Type.String()),
                  to: Type.Optional(Type.String()),
                  accountId: Type.Optional(Type.String()),
                  mode: optionalStringEnum(["announce", "webhook"] as const),
                },
                { additionalProperties: true },
              ),
            ),
          },
          { additionalProperties: true },
        ),
      ),
      description: Type.Optional(Type.String()),
      enabled: Type.Optional(Type.Boolean()),
      deleteAfterRun: Type.Optional(Type.Boolean()),
      agentId: nullableStringSchema("Agent id, or null to clear it"),
      sessionKey: nullableStringSchema("Explicit session key, or null to clear it"),
      failureAlert: CronFailureAlertSchema,
    },
    { additionalProperties: true },
  ),
);

export const CronToolSchema = Type.Object(
  {
    action: stringEnum(CRON_ACTIONS),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    includeDisabled: Type.Optional(Type.Boolean()),
    job: CronJobObjectSchema,
    jobId: Type.Optional(Type.String()),
    id: Type.Optional(Type.String()),
    patch: CronPatchObjectSchema,
    text: Type.Optional(Type.String()),
    mode: optionalStringEnum(CRON_WAKE_MODES),
    runMode: optionalStringEnum(CRON_RUN_MODES),
    contextMessages: Type.Optional(
      Type.Number({ minimum: 0, maximum: REMINDER_CONTEXT_MESSAGES_MAX }),
    ),
  },
  { additionalProperties: true },
);

function isMissingOrEmptyObject(value: unknown): boolean {
  return (
    !value ||
    (typeof value === "object" &&
      value !== null &&
      Object.keys(value as Record<string, unknown>).length === 0)
  );
}

export function recoverFlatCronObject(
  params: Record<string, unknown>,
  key: "job" | "patch",
): { recovered: boolean } {
  if (!isMissingOrEmptyObject(params[key])) {
    return { recovered: false };
  }

  const synthetic: Record<string, unknown> = {};
  let found = false;
  for (const candidate of Object.keys(params)) {
    if (CRON_RECOVERABLE_OBJECT_KEYS.has(candidate) && params[candidate] !== undefined) {
      synthetic[candidate] = params[candidate];
      found = true;
    }
  }

  if (!found) {
    return { recovered: false };
  }
  if (
    key === "job" &&
    synthetic.schedule === undefined &&
    synthetic.payload === undefined &&
    synthetic.message === undefined &&
    synthetic.text === undefined
  ) {
    return { recovered: false };
  }

  params[key] = synthetic;
  return { recovered: true };
}
