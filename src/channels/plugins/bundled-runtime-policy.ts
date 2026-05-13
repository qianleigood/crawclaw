export const BUNDLED_TS_CHANNEL_RUNTIME_DISABLED_REASON =
  "native channel runtime is authoritative; bundled TS channel runtime is disabled outside tests";

export function shouldAllowBundledTsChannelRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "test") {
    return true;
  }
  return Boolean(env.VITEST);
}
