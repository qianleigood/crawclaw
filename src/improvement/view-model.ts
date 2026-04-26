import type {
  ImprovementCenterErrorCode,
  ImprovementProposalDetail,
  ImprovementProposalListItem,
} from "./center.js";
import type { ImprovementPatchPlan, ImprovementProposalStatus } from "./types.js";

export type ImprovementActionName = "approve" | "reject" | "apply" | "verify" | "rollback";

export type DisabledImprovementAction = {
  action: ImprovementActionName;
  reason: string;
};

export type ImprovementListViewItem = {
  id: string;
  title: string;
  kind: ImprovementPatchPlan["kind"];
  kindLabel: string;
  status: ImprovementProposalStatus;
  statusLabel: string;
  riskLabel: string;
  confidenceLabel: string;
  signalSummary: string;
  updatedAt: number;
};

export type ImprovementDetailView = ImprovementListViewItem & {
  plainSummary: string;
  primaryReason: string;
  safetySummary: string;
  changeSummary: string;
  canUndo: boolean;
  evidenceItems: Array<{ label: string; value: string }>;
  verificationPlan: string[];
  rollbackPlan: string[];
  patchPreview: {
    title: string;
    lines: string[];
  };
  availableActions: ImprovementActionName[];
  disabledActions: DisabledImprovementAction[];
  technicalDetails: Record<string, unknown>;
};

export type ImprovementUserErrorView = {
  title: string;
  message: string;
};

const STATUS_LABELS: Record<ImprovementProposalStatus, string> = {
  draft: "Draft",
  policy_blocked: "Blocked by policy",
  pending_review: "Needs review",
  approved: "Approved",
  applying: "Applying",
  verifying: "Verifying",
  applied: "Applied",
  rejected: "Rejected",
  failed: "Failed",
  superseded: "Superseded",
  rolled_back: "Rolled back",
};

const RISK_LABELS = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
} as const;

const CONFIDENCE_LABELS = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
} as const;

function assertNever(value: never): never {
  throw new Error(`Unhandled improvement view value: ${String(value)}`);
}

function kindLabel(kind: ImprovementPatchPlan["kind"]): string {
  switch (kind) {
    case "skill":
      return "Suggested Skill";
    case "workflow":
      return "Suggested Workflow";
    case "code":
      return "Code Change Proposal";
  }
  return assertNever(kind);
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function titleFor(kind: ImprovementPatchPlan["kind"], signalSummary: string): string {
  return `${kindLabel(kind)}: ${signalSummary}`;
}

function patchPreview(plan: ImprovementPatchPlan): ImprovementDetailView["patchPreview"] {
  if (plan.kind === "skill") {
    return {
      title: "Skill file preview",
      lines: [
        `Target: ${plan.targetDir}/${plan.skillName}/SKILL.md`,
        "",
        ...plan.markdown.split(/\r?\n/).slice(0, 120),
      ],
    };
  }
  if (plan.kind === "workflow") {
    return {
      title: "Workflow registry update",
      lines: [
        `Target: ${plan.workflowRef ?? "new workflow"}`,
        `Mode: ${plan.patch.mode}`,
        "requiresApproval: true",
        "safeForAutoRun: false",
        JSON.stringify(plan.patch, null, 2),
      ],
    };
  }
  return {
    title: "Manual code proposal",
    lines: [
      plan.summary,
      "",
      "This proposal cannot be applied automatically.",
      "Use an isolated worktree and normal review flow.",
    ],
  };
}

function changeSummary(plan: ImprovementPatchPlan): string {
  if (plan.kind === "skill") {
    return `Create workspace skill ${plan.targetDir}/${plan.skillName}/SKILL.md.`;
  }
  if (plan.kind === "workflow") {
    return `Update workflow ${plan.workflowRef ?? "new workflow"} through the workflow registry.`;
  }
  return "Prepare a manual code proposal for an isolated implementation worktree.";
}

function plainSummary(plan: ImprovementPatchPlan): string {
  if (plan.kind === "skill") {
    return "CrawClaw suggests creating a Skill from a repeated, validated pattern.";
  }
  if (plan.kind === "workflow") {
    return "CrawClaw suggests creating or updating a Workflow from a repeated, validated pattern.";
  }
  return "CrawClaw suggests recording a manual code change proposal from a repeated pattern.";
}

function evidenceItems(detail: ImprovementProposalDetail): Array<{ label: string; value: string }> {
  const proposal = detail.proposal;
  const items = [
    ...detail.evidenceRefs.map((ref) => ({
      label: ref.kind,
      value: ref.ref,
    })),
    ...proposal.candidate.repeatedActions.map((value) => ({
      label: "action",
      value,
    })),
    ...proposal.candidate.validationEvidence.map((value) => ({
      label: "validation",
      value,
    })),
  ];
  if (items.length > 0) {
    return items;
  }
  return [
    { label: "evidence", value: "No evidence references were recorded." },
    { label: "validation", value: "No validation evidence was recorded." },
  ];
}

function disabledActions(detail: ImprovementProposalDetail): DisabledImprovementAction[] {
  const proposal = detail.proposal;
  const available = new Set(detail.availableActions);
  const disabled: DisabledImprovementAction[] = [];
  if (!available.has("apply")) {
    if (proposal.patchPlan.kind === "code") {
      disabled.push({
        action: "apply",
        reason: "Code proposals require a manual isolated worktree and review.",
      });
    } else if (proposal.status !== "approved") {
      disabled.push({ action: "apply", reason: "Approve this proposal before applying it." });
    }
  }
  if (!available.has("verify")) {
    if (proposal.patchPlan.kind === "code") {
      disabled.push({
        action: "verify",
        reason: "Code proposals must be verified through the manual code review flow.",
      });
    } else if (proposal.status !== "applied") {
      disabled.push({ action: "verify", reason: "Verification is available after apply." });
    }
  }
  if (!available.has("rollback")) {
    if (proposal.patchPlan.kind === "code") {
      disabled.push({
        action: "rollback",
        reason: "Code proposals do not support automatic rollback.",
      });
    } else if (proposal.status !== "applied") {
      disabled.push({
        action: "rollback",
        reason: "Rollback is available after a proposal is applied.",
      });
    }
  }
  return disabled;
}

export function buildImprovementListViewItem(
  item: ImprovementProposalListItem,
): ImprovementListViewItem {
  return {
    id: item.id,
    title: titleFor(item.kind, item.signalSummary),
    kind: item.kind,
    kindLabel: kindLabel(item.kind),
    status: item.status,
    statusLabel: STATUS_LABELS[item.status],
    riskLabel: RISK_LABELS[item.riskLevel],
    confidenceLabel: CONFIDENCE_LABELS[item.confidence],
    signalSummary: item.signalSummary,
    updatedAt: item.updatedAt,
  };
}

export function buildImprovementDetailView(
  detail: ImprovementProposalDetail,
): ImprovementDetailView {
  const proposal = detail.proposal;
  const listItem = buildImprovementListViewItem({
    id: proposal.id,
    status: proposal.status,
    candidateId: proposal.candidate.id,
    kind: proposal.patchPlan.kind,
    signalSummary: proposal.candidate.signalSummary,
    decision: proposal.verdict.decision,
    riskLevel: proposal.verdict.riskLevel,
    confidence: proposal.verdict.confidence,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  });
  const blockers = detail.policyBlockers;
  return {
    ...listItem,
    plainSummary: plainSummary(proposal.patchPlan),
    primaryReason: sentence(proposal.candidate.signalSummary),
    safetySummary: blockers.length
      ? `Policy blocked this proposal: ${blockers.join("; ")}.`
      : `${RISK_LABELS[proposal.verdict.riskLevel]}. Policy allows this proposal.`,
    changeSummary: changeSummary(proposal.patchPlan),
    canUndo: proposal.patchPlan.kind !== "code" && proposal.rollbackPlan.length > 0,
    evidenceItems: evidenceItems(detail),
    verificationPlan: proposal.verdict.verificationPlan.length
      ? proposal.verdict.verificationPlan
      : ["No verification plan was recorded."],
    rollbackPlan: proposal.rollbackPlan.length
      ? proposal.rollbackPlan
      : ["No rollback plan was recorded."],
    patchPreview: patchPreview(proposal.patchPlan),
    availableActions: detail.availableActions.filter(
      (action): action is ImprovementActionName =>
        action === "approve" ||
        action === "reject" ||
        action === "apply" ||
        action === "verify" ||
        action === "rollback",
    ),
    disabledActions: disabledActions(detail),
    technicalDetails: {
      candidateId: proposal.candidate.id,
      decision: proposal.verdict.decision,
      observedFrequency: proposal.candidate.observedFrequency,
      status: proposal.status,
      policyResult: proposal.policyResult,
      application: proposal.application,
      rollback: proposal.rollback,
    },
  };
}

export function mapImprovementCenterError(
  code: ImprovementCenterErrorCode,
): ImprovementUserErrorView {
  switch (code) {
    case "not_found":
      return { title: "Proposal not found", message: "This proposal no longer exists." };
    case "policy_blocked":
      return {
        title: "Blocked by policy",
        message: "Policy does not allow applying this proposal.",
      };
    case "review_required":
      return { title: "Approval required", message: "Approve this proposal before applying it." };
    case "apply_not_supported":
      return {
        title: "Apply not supported",
        message: "This proposal type cannot be applied automatically.",
      };
    case "rollback_not_supported":
      return {
        title: "Rollback not supported",
        message: "This proposal has no supported rollback path.",
      };
    case "verification_failed":
      return { title: "Verification failed", message: "Verification ran and reported errors." };
  }
  return assertNever(code);
}
