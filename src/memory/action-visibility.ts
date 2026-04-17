export type MemoryVisibilityKind = "extraction" | "session_summary" | "dream";

export type MemoryVisibilityPhase =
  | "scheduled"
  | "running"
  | "failed_to_start"
  | "wait_failed"
  | "invalid_report"
  | "orient"
  | "gather"
  | "final";

export type MemoryVisibilityResultStatus = "written" | "skipped" | "no_change" | "failed";

export type MemoryVisibilityProjection = {
  projectedTitle: string;
  projectedSummary?: string;
};

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function resolveMemoryTitle(params: {
  kind: MemoryVisibilityKind;
  phase: MemoryVisibilityPhase;
  resultStatus?: MemoryVisibilityResultStatus;
}): string {
  if (params.kind === "extraction") {
    switch (params.phase) {
      case "scheduled":
        return "Memory extraction scheduled";
      case "running":
        return "Memory extraction running";
      case "failed_to_start":
        return "Memory extraction failed to start";
      case "wait_failed":
        return "Memory extraction did not complete";
      case "invalid_report":
        return "Memory extraction report invalid";
      case "final":
        switch (params.resultStatus) {
          case "written":
            return "Memory extraction wrote durable notes";
          case "skipped":
            return "Memory extraction skipped";
          case "no_change":
            return "Memory extraction found no durable changes";
          default:
            return "Memory extraction failed";
        }
    }
  }
  if (params.kind === "session_summary") {
    switch (params.phase) {
      case "scheduled":
        return "Session summary scheduled";
      case "running":
        return "Session summary running";
      case "failed_to_start":
        return "Session summary failed to start";
      case "wait_failed":
        return "Session summary did not complete";
      case "invalid_report":
        return "Session summary report invalid";
      case "final":
        switch (params.resultStatus) {
          case "written":
            return "Session summary updated";
          case "skipped":
            return "Session summary skipped";
          case "no_change":
            return "Session summary unchanged";
          default:
            return "Session summary failed";
        }
      default:
        return "Session summary";
    }
  }
  switch (params.phase) {
    case "orient":
      return "Dream orienting";
    case "gather":
      return "Dream gathering signal";
    case "running":
      return "Dream running";
    case "failed_to_start":
      return "Dream failed to start";
    case "wait_failed":
      return "Dream did not complete";
    case "invalid_report":
      return "Dream report invalid";
    case "final":
      switch (params.resultStatus) {
        case "written":
          return "Dream updated durable notes";
        case "skipped":
          return "Dream skipped";
        case "no_change":
          return "Dream found no changes";
        default:
          return "Dream failed";
      }
    default:
      return "Dream";
  }
}

export function buildMemoryActionVisibilityProjection(params: {
  kind: MemoryVisibilityKind;
  phase: MemoryVisibilityPhase;
  summary?: string;
  resultStatus?: MemoryVisibilityResultStatus;
}): MemoryVisibilityProjection {
  const projectedTitle = resolveMemoryTitle({
    kind: params.kind,
    phase: params.phase,
    resultStatus: params.resultStatus,
  });
  const projectedSummary = normalizeOptionalString(params.summary);
  if (!projectedSummary || projectedSummary === projectedTitle) {
    return { projectedTitle };
  }
  return {
    projectedTitle,
    projectedSummary,
  };
}
