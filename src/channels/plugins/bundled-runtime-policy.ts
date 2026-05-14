export const BUNDLED_TS_CHANNEL_RUNTIME_DISABLED_REASON =
  "native channel runtime is authoritative; bundled TS channel runtime is disabled outside tests";

export function shouldAllowBundledTsChannelRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (env.NODE_ENV === "test") {
    return true;
  }
  return Boolean(env.VITEST);
}

export function assertBundledTsChannelRuntimeAllowed(
  surface: string,
  env?: Readonly<Record<string, string | undefined>>,
): void {
  if (shouldAllowBundledTsChannelRuntime(env)) {
    return;
  }
  throw new Error(`${surface} is disabled: ${BUNDLED_TS_CHANNEL_RUNTIME_DISABLED_REASON}`);
}
