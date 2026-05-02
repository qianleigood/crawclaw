export type MemoryVisibilityKind = "durable_memory" | "session_summary" | "dream";

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
  if (params.kind === "durable_memory") {
    switch (params.phase) {
      case "scheduled":
        return "Durable memory agent scheduled";
      case "running":
        return "Durable memory agent running";
      case "failed_to_start":
        return "Durable memory agent failed to start";
      case "wait_failed":
        return "Durable memory agent did not complete";
      case "invalid_report":
        return "Durable memory agent report invalid";
      case "final":
        switch (params.resultStatus) {
          case "written":
            return "Durable memory agent wrote durable notes";
          case "skipped":
            return "Durable memory agent skipped";
          case "no_change":
            return "Durable memory agent found no durable changes";
          default:
            return "Durable memory agent failed";
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
