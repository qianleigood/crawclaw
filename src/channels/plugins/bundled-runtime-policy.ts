export const BUNDLED_TS_CHANNEL_RUNTIME_DISABLED_REASON =
  "native channel runtime is authoritative; bundled TS channel runtime is disabled outside tests or explicit compatibility";

function truthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function shouldAllowBundledTsChannelRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (truthyEnv(env.CRAWCLAW_ENABLE_TS_BUNDLED_CHANNEL_RUNTIME)) {
    return true;
  }
  if (env.NODE_ENV === "test") {
    return true;
  }
  return Boolean(env.VITEST);
}
