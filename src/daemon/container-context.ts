export function resolveDaemonContainerContext(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env.CRAWCLAW_CONTAINER_HINT?.trim() || env.CRAWCLAW_CONTAINER?.trim() || null;
}
