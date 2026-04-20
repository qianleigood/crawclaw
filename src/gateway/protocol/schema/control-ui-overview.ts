import { Type } from "@sinclair/typebox";
import { AgentRuntimeSummaryResultSchema } from "./agent-runtime.js";
import { MemoryProviderStatusSchema } from "./memory.js";
import { HealthSnapshotSchema, PresenceEntrySchema } from "./snapshot.js";
import { UsageStatusResultSchema } from "./usage.js";

export const OverviewSummaryParamsSchema = Type.Object({}, { additionalProperties: false });

export const OverviewSummaryResultSchema = Type.Object(
  {
    health: Type.Optional(HealthSnapshotSchema),
    presence: Type.Optional(Type.Array(PresenceEntrySchema)),
    memory: Type.Optional(MemoryProviderStatusSchema),
    runtime: Type.Optional(AgentRuntimeSummaryResultSchema),
    usage: Type.Optional(UsageStatusResultSchema),
  },
  { additionalProperties: false },
);
