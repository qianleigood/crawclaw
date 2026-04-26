import fs from "node:fs/promises";
import path from "node:path";
import type { CrawClawConfig } from "../config/config.js";
import { deleteWorkflow, rollbackWorkflowDefinition } from "../workflows/registry.js";
import {
  applyImprovementProposal as applyImprovementProposalInternal,
  reviewImprovementProposal as reviewImprovementProposalInternal,
  runImprovementWorkflow,
  verifyImprovementProposalApplication,
} from "./runner.js";
import {
  loadImprovementProposal,
  loadImprovementStoreIndex,
  saveImprovementProposal,
} from "./store.js";
import type {
  ImprovementPatchPlan,
  ImprovementProposal,
  ImprovementProposalIndexEntry,
  ImprovementProposalStatus,
  ImprovementRollbackResult,
  ImprovementWorkflowResult,
} from "./types.js";

export type ImprovementCenterErrorCode =
  | "not_found"
  | "policy_blocked"
  | "review_required"
  | "apply_not_supported"
  | "rollback_not_supported"
  | "verification_failed";

export class ImprovementCenterError extends Error {
  constructor(
    readonly code: ImprovementCenterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImprovementCenterError";
  }
}

export type ImprovementCenterContext = {
  workspaceDir: string;
  config?: CrawClawConfig;
  sessionKey?: string;
};

export type ImprovementProposalListFilters = {
  statuses?: ImprovementProposalStatus[];
  kinds?: ImprovementPatchPlan["kind"][];
  limit?: number;
};

export type ImprovementProposalListItem = ImprovementProposalIndexEntry & {
  signalSummary: string;
  decision: ImprovementProposal["verdict"]["decision"];
  riskLevel: ImprovementProposal["verdict"]["riskLevel"];
  confidence: ImprovementProposal["verdict"]["confidence"];
};

export type ImprovementProposalDetail = {
  proposal: ImprovementProposal;
  evidenceRefs: ImprovementProposal["candidate"]["sourceRefs"];
  policyBlockers: string[];
  availableActions: string[];
};

export type ImprovementMetrics = {
  total: number;
  byStatus: Partial<Record<ImprovementProposalStatus, number>>;
  byKind: Partial<Record<ImprovementPatchPlan["kind"], number>>;
  approved: number;
  applied: number;
  rolledBack: number;
  failed: number;
  policyBlocked: number;
};

function increment<K extends string>(record: Partial<Record<K, number>>, key: K): void {
  record[key] = (record[key] ?? 0) + 1;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 50;
  }
  return Math.max(1, Math.min(200, Math.trunc(value)));
}

async function loadProposalOrThrow(
  context: ImprovementCenterContext,
  proposalId: string,
): Promise<ImprovementProposal> {
  const proposal = await loadImprovementProposal(context, proposalId);
  if (!proposal) {
    throw new ImprovementCenterError(
      "not_found",
      `Improvement proposal "${proposalId}" not found.`,
    );
  }
  return proposal;
}

function actionList(proposal: ImprovementProposal): string[] {
  const actions = ["show"];
  if (proposal.status === "pending_review") {
    actions.push("approve", "reject");
  }
  if (proposal.status === "approved" && proposal.patchPlan.kind !== "code") {
    actions.push("apply");
  }
  if (proposal.status === "applied") {
    actions.push("verify");
    if (proposal.patchPlan.kind !== "code") {
      actions.push("rollback");
    }
  }
  return actions;
}

function resolveWorkspaceRelativePath(workspaceDir: string, relativePath: string): string {
  const resolved = path.resolve(workspaceDir, relativePath);
  const root = path.resolve(workspaceDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new ImprovementCenterError(
      "rollback_not_supported",
      `Rollback path escapes workspace: ${relativePath}`,
    );
  }
  return resolved;
}

async function deleteFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function listImprovementProposals(
  context: ImprovementCenterContext,
  filters: ImprovementProposalListFilters = {},
): Promise<ImprovementProposalListItem[]> {
  const store = await loadImprovementStoreIndex(context);
  const statuses = new Set(filters.statuses ?? []);
  const kinds = new Set(filters.kinds ?? []);
  const limit = normalizeLimit(filters.limit);
  const entries = store.proposals.filter((entry) => {
    if (statuses.size > 0 && !statuses.has(entry.status)) {
      return false;
    }
    if (kinds.size > 0 && !kinds.has(entry.kind)) {
      return false;
    }
    return true;
  });
  const proposals = await Promise.all(
    entries.slice(0, limit).map(async (entry) => await loadImprovementProposal(context, entry.id)),
  );
  return proposals
    .filter((proposal): proposal is ImprovementProposal => Boolean(proposal))
    .map((proposal) => ({
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
    }))
    .toSorted((left, right) => right.updatedAt - left.updatedAt);
}

export async function getImprovementProposalDetail(
  context: ImprovementCenterContext,
  proposalId: string,
): Promise<ImprovementProposalDetail> {
  const proposal = await loadProposalOrThrow(context, proposalId);
  return {
    proposal,
    evidenceRefs: proposal.candidate.sourceRefs,
    policyBlockers: proposal.policyResult?.blockers ?? [],
    availableActions: actionList(proposal),
  };
}

export async function runImprovementScan(params: {
  workspaceDir: string;
  config?: CrawClawConfig;
  embeddedJudgeContext?: Parameters<typeof runImprovementWorkflow>[0]["embeddedJudgeContext"];
}): Promise<ImprovementWorkflowResult> {
  return await runImprovementWorkflow(params);
}

export async function reviewImprovementProposal(params: {
  workspaceDir: string;
  proposalId: string;
  approved: boolean;
  reviewer?: string;
  comments?: string;
}): Promise<ImprovementProposal> {
  await loadProposalOrThrow(params, params.proposalId);
  return await reviewImprovementProposalInternal(params);
}

export async function applyImprovementProposal(params: {
  workspaceDir: string;
  proposalId: string;
  config?: CrawClawConfig;
  sessionKey?: string;
}): Promise<ImprovementProposal> {
  const proposal = await loadProposalOrThrow(params, params.proposalId);
  if (proposal.patchPlan.kind === "code") {
    throw new ImprovementCenterError(
      "apply_not_supported",
      "Code improvement proposals require the manual code-improvement flow.",
    );
  }
  if (proposal.policyResult?.allowed !== true) {
    throw new ImprovementCenterError("policy_blocked", "Improvement proposal is policy blocked.");
  }
  if (proposal.review?.approved !== true) {
    throw new ImprovementCenterError(
      "review_required",
      "Improvement proposal requires approval before apply.",
    );
  }
  const applied = await applyImprovementProposalInternal(params);
  if (applied.verificationResult && !applied.verificationResult.passed) {
    throw new ImprovementCenterError(
      "verification_failed",
      applied.verificationResult.errors.join("; ") || "Improvement verification failed.",
    );
  }
  return applied;
}

export async function verifyImprovementProposal(params: {
  workspaceDir: string;
  proposalId: string;
  config?: CrawClawConfig;
}): Promise<ImprovementProposal> {
  const proposal = await loadProposalOrThrow(params, params.proposalId);
  if (proposal.patchPlan.kind === "code") {
    throw new ImprovementCenterError(
      "apply_not_supported",
      "Code improvement proposals require the manual code-improvement flow.",
    );
  }
  const verified = await verifyImprovementProposalApplication(params);
  if (verified.verificationResult && !verified.verificationResult.passed) {
    throw new ImprovementCenterError(
      "verification_failed",
      verified.verificationResult.errors.join("; ") || "Improvement verification failed.",
    );
  }
  return verified;
}

export async function rollbackImprovementProposal(params: {
  workspaceDir: string;
  proposalId: string;
  sessionKey?: string;
}): Promise<ImprovementProposal> {
  const proposal = await loadProposalOrThrow(params, params.proposalId);
  if (proposal.patchPlan.kind === "code") {
    throw new ImprovementCenterError(
      "rollback_not_supported",
      "Code improvement proposals do not support automatic rollback.",
    );
  }
  if (!proposal.application) {
    throw new ImprovementCenterError(
      "rollback_not_supported",
      "Improvement proposal has no recorded application artifact.",
    );
  }

  const rollbackBase: Omit<ImprovementRollbackResult, "success" | "note" | "errors"> = {
    kind: proposal.patchPlan.kind,
    rolledBackAt: Date.now(),
  };
  try {
    let note: string;
    if (proposal.application.kind === "skill") {
      const skillPath = resolveWorkspaceRelativePath(
        params.workspaceDir,
        proposal.application.relativePath,
      );
      if (proposal.application.created) {
        await deleteFileIfExists(skillPath);
        await fs.rmdir(path.dirname(skillPath)).catch(() => {});
        note = `Deleted ${proposal.application.relativePath}.`;
      } else if (proposal.application.previousMarkdown !== undefined) {
        await fs.mkdir(path.dirname(skillPath), { recursive: true });
        await fs.writeFile(skillPath, proposal.application.previousMarkdown, "utf8");
        note = `Restored ${proposal.application.relativePath}.`;
      } else {
        throw new ImprovementCenterError(
          "rollback_not_supported",
          "Skill rollback is missing previous markdown.",
        );
      }
    } else if (proposal.application.created) {
      const deleted = await deleteWorkflow(
        { workspaceDir: params.workspaceDir },
        proposal.application.workflowRef,
      );
      if (!deleted.deleted) {
        throw new ImprovementCenterError(
          "not_found",
          `Workflow "${proposal.application.workflowRef}" not found.`,
        );
      }
      note = `Deleted workflow ${proposal.application.workflowRef}.`;
    } else if (proposal.application.previousSpecVersion !== undefined) {
      const rolledBack = await rollbackWorkflowDefinition(
        { workspaceDir: params.workspaceDir, sessionKey: params.sessionKey },
        proposal.application.workflowRef,
        proposal.application.previousSpecVersion,
      );
      if (!rolledBack) {
        throw new ImprovementCenterError(
          "not_found",
          `Workflow "${proposal.application.workflowRef}" not found.`,
        );
      }
      note = `Rolled workflow ${proposal.application.workflowRef} back to spec version ${proposal.application.previousSpecVersion}.`;
    } else {
      throw new ImprovementCenterError(
        "rollback_not_supported",
        "Workflow rollback is missing a previous spec version.",
      );
    }

    return await saveImprovementProposal(
      { workspaceDir: params.workspaceDir },
      {
        ...proposal,
        status: "rolled_back",
        rollback: {
          ...rollbackBase,
          success: true,
          note,
          errors: [],
        },
      },
    );
  } catch (error) {
    if (error instanceof ImprovementCenterError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    await saveImprovementProposal(
      { workspaceDir: params.workspaceDir },
      {
        ...proposal,
        rollback: {
          ...rollbackBase,
          success: false,
          errors: [message],
        },
      },
    );
    throw new ImprovementCenterError("rollback_not_supported", message);
  }
}

export async function summarizeImprovementMetrics(
  context: ImprovementCenterContext,
): Promise<ImprovementMetrics> {
  const proposals = await listImprovementProposals(context, { limit: 200 });
  const metrics: ImprovementMetrics = {
    total: proposals.length,
    byStatus: {},
    byKind: {},
    approved: 0,
    applied: 0,
    rolledBack: 0,
    failed: 0,
    policyBlocked: 0,
  };
  for (const proposal of proposals) {
    increment(metrics.byStatus, proposal.status);
    increment(metrics.byKind, proposal.kind);
    if (proposal.status === "approved" || proposal.status === "applied") {
      metrics.approved += 1;
    }
    if (proposal.status === "applied") {
      metrics.applied += 1;
    }
    if (proposal.status === "rolled_back") {
      metrics.rolledBack += 1;
    }
    if (proposal.status === "failed") {
      metrics.failed += 1;
    }
    if (proposal.status === "policy_blocked") {
      metrics.policyBlocked += 1;
    }
  }
  return metrics;
}
