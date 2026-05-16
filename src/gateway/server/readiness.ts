export type ReadinessResult = {
  ready: boolean;
  failing: string[];
  uptimeMs: number;
};

export type ReadinessChecker = () => ReadinessResult;

const DEFAULT_READINESS_CACHE_TTL_MS = 1_000;

export function createReadinessChecker(deps: {
  startedAt: number;
  cacheTtlMs?: number;
}): ReadinessChecker {
  const { startedAt } = deps;
  const cacheTtlMs = Math.max(0, deps.cacheTtlMs ?? DEFAULT_READINESS_CACHE_TTL_MS);
  let cachedAt = 0;
  let cachedState: Omit<ReadinessResult, "uptimeMs"> | null = null;

  return (): ReadinessResult => {
    const now = Date.now();
    const uptimeMs = now - startedAt;
    if (cachedState && now - cachedAt < cacheTtlMs) {
      return { ...cachedState, uptimeMs };
    }

    cachedAt = now;
    cachedState = { ready: true, failing: [] };
    return { ...cachedState, uptimeMs };
  };
}
