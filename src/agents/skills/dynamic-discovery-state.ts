type SkillDiscoveryScope = {
  sessionId?: string;
  sessionKey?: string;
};

const discoveredSkillDirsBySession = new Map<string, Set<string>>();

function resolveScopeKey(scope: SkillDiscoveryScope): string | null {
  const sessionId = scope.sessionId?.trim();
  if (sessionId) {
    return `sessionId:${sessionId}`;
  }
  const sessionKey = scope.sessionKey?.trim();
  if (sessionKey) {
    return `sessionKey:${sessionKey}`;
  }
  return null;
}

export function getDiscoveredSkillDirs(scope: SkillDiscoveryScope): string[] {
  const key = resolveScopeKey(scope);
  if (!key) {
    return [];
  }
  return [...(discoveredSkillDirsBySession.get(key) ?? new Set<string>())];
}

export function recordDiscoveredSkillDirs(
  scope: SkillDiscoveryScope,
  discoveredSkillDirs: readonly string[],
): void {
  const key = resolveScopeKey(scope);
  if (!key) {
    return;
  }
  const current = discoveredSkillDirsBySession.get(key) ?? new Set<string>();
  for (const dir of discoveredSkillDirs) {
    const normalized = typeof dir === "string" ? dir.trim() : "";
    if (!normalized) {
      continue;
    }
    current.add(normalized);
  }
  discoveredSkillDirsBySession.set(key, current);
}

export function clearDiscoveredSkillDirsForTest(): void {
  discoveredSkillDirsBySession.clear();
}
