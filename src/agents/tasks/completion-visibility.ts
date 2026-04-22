export type CompletionVisibilityProjection = {
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

function resolveCompletionTitle(params: {
  status: string;
  detail?: Record<string, unknown>;
}): string {
  const completionStatus = normalizeOptionalString(params.detail?.completionStatus)?.toLowerCase();
  const blockingState = normalizeOptionalString(params.detail?.blockingState)?.toLowerCase();
  switch (completionStatus) {
    case "accepted":
      return "Completion accepted";
    case "accepted_with_warnings":
      return "Completion accepted with warnings";
    case "waiting_user":
      return "Waiting for user confirmation";
    case "waiting_external":
      return "Waiting for external condition";
    case "incomplete":
      if (blockingState === "review_missing") {
        return "Completion missing review";
      }
      return "Completion incomplete";
  }
  if (params.status === "completed") {
    return "Completion accepted";
  }
  if (params.status === "waiting") {
    return "Waiting for completion";
  }
  if (params.status === "blocked") {
    return "Completion incomplete";
  }
  return "Completion";
}

export function buildCompletionActionVisibilityProjection(params: {
  status: string;
  summary?: string;
  detail?: Record<string, unknown>;
}): CompletionVisibilityProjection {
  const projectedTitle = resolveCompletionTitle({
    status: params.status,
    detail: params.detail,
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
