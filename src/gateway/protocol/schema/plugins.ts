import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const PluginsListParamsSchema = Type.Object({}, { additionalProperties: false });

export const PluginsEnableParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    baseHash: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const PluginsDisableParamsSchema = Type.Object(
  {
    id: NonEmptyString,
    baseHash: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);

export const PluginsInstallParamsSchema = Type.Object(
  {
    raw: NonEmptyString,
    baseHash: Type.Optional(NonEmptyString),
  },
  { additionalProperties: false },
);
