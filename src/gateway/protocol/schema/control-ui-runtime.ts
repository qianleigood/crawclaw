import { Type } from "@sinclair/typebox";

export const RuntimePageSummaryParamsSchema = Type.Object({}, { additionalProperties: false });

export const RuntimePageSummaryResultSchema = Type.Object(
  {
    summary: Type.Optional(Type.Unknown()),
    runs: Type.Optional(Type.Array(Type.Unknown())),
    selection: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);
