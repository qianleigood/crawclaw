import { Type } from "@sinclair/typebox";

export const AgentsPageSummaryParamsSchema = Type.Object({}, { additionalProperties: false });

export const AgentsPageSummaryResultSchema = Type.Object(
  {
    agents: Type.Optional(Type.Array(Type.Unknown())),
    inspection: Type.Optional(Type.Unknown()),
    tools: Type.Optional(Type.Array(Type.Unknown())),
  },
  { additionalProperties: false },
);
