const ISOLATED_SPECIAL_AGENT_SPAWN_SOURCES = new Set([
  "durable-memory",
  "session-summary",
  "dream",
]);

export function shouldUseIsolatedSpecialAgentContext(
  spawnSource: string | null | undefined,
): boolean {
  const normalized = spawnSource?.trim();
  return normalized !== undefined && ISOLATED_SPECIAL_AGENT_SPAWN_SOURCES.has(normalized);
}
