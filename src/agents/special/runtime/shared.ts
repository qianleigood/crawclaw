export function resolveRunTimeoutSeconds(params: {
  requested?: number;
  fallback?: number;
}): number | undefined {
  const candidate =
    typeof params.requested === "number" && Number.isFinite(params.requested)
      ? params.requested
      : params.fallback;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    return undefined;
  }
  return Math.max(1, Math.floor(candidate));
}

export function resolveMaxTurns(params: {
  requested?: number;
  fallback?: number;
}): number | undefined {
  const candidate =
    typeof params.requested === "number" && Number.isFinite(params.requested)
      ? params.requested
      : params.fallback;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    return undefined;
  }
  return Math.max(1, Math.floor(candidate));
}

export function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
