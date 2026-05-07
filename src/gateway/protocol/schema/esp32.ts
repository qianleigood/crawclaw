import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const Esp32StatusGetParamsSchema = Type.Object({}, { additionalProperties: false });

export const Esp32PairingStartParamsSchema = Type.Object(
  {
    name: Type.Optional(NonEmptyString),
    ttlMs: Type.Optional(Type.Integer({ minimum: 60_000, maximum: 30 * 60 * 1000 })),
  },
  { additionalProperties: false },
);

export const Esp32PairingRequestsListParamsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const Esp32PairingRequestApproveParamsSchema = Type.Object(
  { requestId: NonEmptyString },
  { additionalProperties: false },
);

export const Esp32PairingRequestRejectParamsSchema = Type.Object(
  { requestId: NonEmptyString },
  { additionalProperties: false },
);

export const Esp32PairingSessionRevokeParamsSchema = Type.Object(
  { pairId: NonEmptyString },
  { additionalProperties: false },
);

export const Esp32DevicesListParamsSchema = Type.Object({}, { additionalProperties: false });

export const Esp32DeviceGetParamsSchema = Type.Object(
  { deviceId: NonEmptyString },
  { additionalProperties: false },
);

export const Esp32DeviceRevokeParamsSchema = Type.Object(
  { deviceId: NonEmptyString },
  { additionalProperties: false },
);

export const Esp32DeviceCommandSendParamsSchema = Type.Object(
  {
    deviceId: NonEmptyString,
    text: NonEmptyString,
  },
  { additionalProperties: false },
);
