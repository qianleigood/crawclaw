export const TS_GATEWAY_RUNTIME_DISABLED_MESSAGE =
  "The TypeScript Gateway server runtime is disabled. Use the Rust crawclaw-gateway binary.";

export function assertTypeScriptGatewayRuntimeAllowed(): void {
  if (
    process.env.VITEST ||
    process.env.VITEST_POOL_ID !== undefined ||
    process.env.NODE_ENV === "test"
  ) {
    return;
  }
  throw new Error(TS_GATEWAY_RUNTIME_DISABLED_MESSAGE);
}

assertTypeScriptGatewayRuntimeAllowed();
