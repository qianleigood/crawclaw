export type ApprovalVisibilityKind = "exec" | "plugin" | "unknown";

export type ApprovalVisibilityProjection = {
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

function resolveApprovalKind(params: {
  kind?: ApprovalVisibilityKind;
  title?: string;
  detail?: Record<string, unknown>;
}): ApprovalVisibilityKind {
  if (params.kind && params.kind !== "unknown") {
    return params.kind;
  }
  const detailKind = normalizeOptionalString(params.detail?.kind)?.toLowerCase();
  if (detailKind === "exec" || detailKind === "plugin") {
    return detailKind;
  }
  const title = normalizeOptionalString(params.title)?.toLowerCase();
  if (title?.includes("plugin approval")) {
    return "plugin";
  }
  if (title?.includes("exec approval")) {
    return "exec";
  }
  return "unknown";
}

function resolveApprovalTitle(params: {
  status: string;
  approvalKind: ApprovalVisibilityKind;
  reason?: string;
  decision?: string;
}): string {
  if (params.status === "waiting" || params.status === "started" || params.status === "running") {
    if (params.approvalKind === "plugin") {
      return "Waiting for plugin approval";
    }
    if (params.approvalKind === "exec") {
      return "Waiting for exec approval";
    }
    return "Waiting for approval";
  }
  if (params.status === "completed") {
    return "Approval granted";
  }
  if (params.status === "blocked") {
    if (params.reason === "no-approval-route") {
      return "Approval unavailable";
    }
    if (params.decision === "deny") {
      return "Approval denied";
    }
    return "Approval blocked";
  }
  if (params.status === "cancelled") {
    return "Approval cancelled";
  }
  if (params.status === "failed") {
    return "Approval failed";
  }
  return "Approval";
}

function resolveApprovalSummary(params: {
  title: string;
  summary?: string;
  reason?: string;
}): string | undefined {
  const summary = normalizeOptionalString(params.summary);
  if (!summary || summary === params.title) {
    return undefined;
  }
  if (summary === "no-approval-route" || params.reason === "no-approval-route") {
    return undefined;
  }
  return summary;
}

export function buildApprovalActionVisibilityProjection(params: {
  status: string;
  summary?: string;
  title?: string;
  kind?: ApprovalVisibilityKind;
  detail?: Record<string, unknown>;
}): ApprovalVisibilityProjection {
  const approvalKind = resolveApprovalKind({
    kind: params.kind,
    title: params.title,
    detail: params.detail,
  });
  const reason = normalizeOptionalString(params.detail?.reason)?.toLowerCase();
  const decision = normalizeOptionalString(params.detail?.decision)?.toLowerCase();
  const projectedTitle = resolveApprovalTitle({
    status: params.status,
    approvalKind,
    reason,
    decision,
  });
  const projectedSummary = resolveApprovalSummary({
    title: projectedTitle,
    summary: params.summary,
    reason,
  });
  return projectedSummary ? { projectedTitle, projectedSummary } : { projectedTitle };
}
