export const GatewayRequestDetailCodes = {
  SCOPE_MISSING: "SCOPE_MISSING",
  METHOD_UNAVAILABLE: "METHOD_UNAVAILABLE",
  CAPABILITY_MISSING: "CAPABILITY_MISSING",
  PATCH_CONFLICT: "PATCH_CONFLICT",
  CONFIG_RELOAD_REQUIRED: "CONFIG_RELOAD_REQUIRED",
  CONFIG_RESTART_REQUIRED: "CONFIG_RESTART_REQUIRED",
} as const;

export type GatewayRequestDetailCode =
  (typeof GatewayRequestDetailCodes)[keyof typeof GatewayRequestDetailCodes];
