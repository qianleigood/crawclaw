import { Type } from "@sinclair/typebox";

export const WorkflowsPageSummaryParamsSchema = Type.Object({}, { additionalProperties: false });

export const WorkflowsPageSummaryResultSchema = Type.Object(
  {
    registry: Type.Optional(Type.Array(Type.Unknown())),
    execution: Type.Optional(Type.Unknown()),
    recentRuns: Type.Optional(Type.Array(Type.Unknown())),
  },
  { additionalProperties: false },
);
