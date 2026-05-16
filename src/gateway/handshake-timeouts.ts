export const DEFAULT_PREAUTH_HANDSHAKE_TIMEOUT_MS = 10_000;

export function getPreauthHandshakeTimeoutMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const configuredTimeout =
    env.CRAWCLAW_HANDSHAKE_TIMEOUT_MS || (env.VITEST && env.CRAWCLAW_TEST_HANDSHAKE_TIMEOUT_MS);
  if (configuredTimeout) {
    const parsed = Number(configuredTimeout);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_PREAUTH_HANDSHAKE_TIMEOUT_MS;
}
