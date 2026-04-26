import { loadConfig } from "../config/config.js";
import {
  applyImprovementProposal,
  getImprovementProposalDetail,
  ImprovementCenterError,
  listImprovementProposals,
  reviewImprovementProposal,
  rollbackImprovementProposal,
  runImprovementScan,
  summarizeImprovementMetrics,
  verifyImprovementProposal,
  type ImprovementCenterContext,
} from "../improvement/center.js";
import type { ImprovementPatchPlan, ImprovementProposalStatus } from "../improvement/types.js";
import type { OutputRuntimeEnv, RuntimeEnv } from "../runtime.js";
import { writeRuntimeJson, writeRuntimeStdout } from "../runtime.js";
import { getTerminalTableWidth, renderTable } from "../terminal/table.js";

export type ImproveJsonOption = {
  json?: boolean;
};

export type ImproveInboxOptions = ImproveJsonOption & {
  status?: string;
  kind?: string;
  limit?: string;
};

export type ImproveReviewOptions = ImproveJsonOption & {
  approve?: boolean;
  reject?: boolean;
  reviewer?: string;
  comments?: string;
};

export type ImproveRuntimeDeps = {
  cwd: () => string;
  loadConfig: typeof loadConfig;
};

const VALID_STATUSES = new Set<ImprovementProposalStatus>([
  "draft",
  "policy_blocked",
  "pending_review",
  "approved",
  "applying",
  "verifying",
  "applied",
  "rejected",
  "failed",
  "superseded",
  "rolled_back",
]);

const VALID_KINDS = new Set<ImprovementPatchPlan["kind"]>(["skill", "workflow", "code"]);

export const defaultImproveRuntimeDeps: ImproveRuntimeDeps = {
  cwd: () => process.cwd(),
  loadConfig,
};

function resolveContext(deps: ImproveRuntimeDeps): ImprovementCenterContext {
  return {
    workspaceDir: deps.cwd(),
  };
}

function parseCsv<T extends string>(value: string | undefined, valid: Set<T>, label: string): T[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (!valid.has(item as T)) {
        throw new Error(`Invalid ${label}: ${item}`);
      }
      return item as T;
    });
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error("--limit must be a positive integer.");
  }
  return parsed;
}

function formatTimestamp(value: number): string {
  return new Date(value).toISOString();
}

function printJson(runtime: RuntimeEnv | OutputRuntimeEnv, value: unknown): void {
  writeRuntimeJson(runtime, value);
}

function printText(runtime: RuntimeEnv | OutputRuntimeEnv, value: string): void {
  writeRuntimeStdout(runtime, value.endsWith("\n") ? value : `${value}\n`);
}

function formatPatchPreview(
  detail: Awaited<ReturnType<typeof getImprovementProposalDetail>>,
): string[] {
  const proposal = detail.proposal;
  if (proposal.patchPlan.kind === "skill") {
    return [
      `kind: skill`,
      `target: ${proposal.patchPlan.targetDir}/${proposal.patchPlan.skillName}/SKILL.md`,
      `markdownBytes: ${proposal.patchPlan.markdown.length}`,
    ];
  }
  if (proposal.patchPlan.kind === "workflow") {
    return [
      `kind: workflow`,
      `mode: ${proposal.patchPlan.patch.mode}`,
      `workflowRef: ${proposal.patchPlan.workflowRef ?? "new"}`,
    ];
  }
  return [`kind: code`, `summary: ${proposal.patchPlan.summary}`];
}

export function handleImproveCliError(
  error: unknown,
  opts: ImproveJsonOption,
  runtime: RuntimeEnv | OutputRuntimeEnv,
): void {
  const code = error instanceof ImprovementCenterError ? error.code : "error";
  const message = error instanceof Error ? error.message : String(error);
  if (opts.json) {
    printJson(runtime, { error: { code, message } });
  } else {
    runtime.error(`${code}: ${message}`);
  }
  runtime.exit(1);
}

export async function runImproveRunCommand(
  opts: ImproveJsonOption,
  runtime: RuntimeEnv | OutputRuntimeEnv,
  deps: ImproveRuntimeDeps = defaultImproveRuntimeDeps,
): Promise<void> {
  const result = await runImprovementScan({
    workspaceDir: deps.cwd(),
    config: deps.loadConfig(),
  });
  if (opts.json) {
    printJson(runtime, result);
    return;
  }
  const proposal = result.proposal ? ` proposal=${result.proposal.id}` : "";
  runtime.log(`Improvement run ${result.run.runId}: ${result.run.status}${proposal}`);
}

export async function runImproveInboxCommand(
  opts: ImproveInboxOptions,
  runtime: RuntimeEnv | OutputRuntimeEnv,
  deps: ImproveRuntimeDeps = defaultImproveRuntimeDeps,
): Promise<void> {
  const proposals = await listImprovementProposals(resolveContext(deps), {
    statuses: parseCsv(opts.status, VALID_STATUSES, "status"),
    kinds: parseCsv(opts.kind, VALID_KINDS, "kind"),
    limit: parseLimit(opts.limit),
  });
  if (opts.json) {
    printJson(runtime, { proposals });
    return;
  }
  if (proposals.length === 0) {
    runtime.log("No improvement proposals.");
    return;
  }
  printText(
    runtime,
    renderTable({
      columns: [
        { key: "id", header: "ID", minWidth: 18, maxWidth: 36, flex: true },
        { key: "kind", header: "Kind", minWidth: 8 },
        { key: "status", header: "Status", minWidth: 14 },
        { key: "risk", header: "Risk", minWidth: 8 },
        { key: "updated", header: "Updated", minWidth: 20 },
        { key: "summary", header: "Summary", minWidth: 24, maxWidth: 60, flex: true },
      ],
      rows: proposals.map((proposal) => ({
        id: proposal.id,
        kind: proposal.kind,
        status: proposal.status,
        risk: proposal.riskLevel,
        updated: formatTimestamp(proposal.updatedAt),
        summary: proposal.signalSummary,
      })),
      width: getTerminalTableWidth(),
    }),
  );
}

export async function runImproveShowCommand(
  proposalId: string,
  opts: ImproveJsonOption,
  runtime: RuntimeEnv | OutputRuntimeEnv,
  deps: ImproveRuntimeDeps = defaultImproveRuntimeDeps,
): Promise<void> {
  const detail = await getImprovementProposalDetail(resolveContext(deps), proposalId);
  if (opts.json) {
    printJson(runtime, detail);
    return;
  }
  const proposal = detail.proposal;
  printText(
    runtime,
    [
      `Proposal: ${proposal.id}`,
      `Status: ${proposal.status}`,
      `Kind: ${proposal.patchPlan.kind}`,
      `Decision: ${proposal.verdict.decision}`,
      `Risk: ${proposal.verdict.riskLevel}`,
      `Confidence: ${proposal.verdict.confidence}`,
      `Actions: ${detail.availableActions.join(", ") || "none"}`,
      "",
      "Signal:",
      proposal.candidate.signalSummary,
      "",
      "Evidence:",
      ...detail.evidenceRefs.map((ref) => `- ${ref.kind}:${ref.ref}`),
      "",
      "Policy:",
      detail.policyBlockers.length > 0 ? detail.policyBlockers.join(", ") : "allowed",
      "",
      "Patch:",
      ...formatPatchPreview(detail).map((line) => `- ${line}`),
    ].join("\n"),
  );
}

export async function runImproveReviewCommand(
  proposalId: string,
  opts: ImproveReviewOptions,
  runtime: RuntimeEnv | OutputRuntimeEnv,
  deps: ImproveRuntimeDeps = defaultImproveRuntimeDeps,
): Promise<void> {
  if (Boolean(opts.approve) === Boolean(opts.reject)) {
    throw new Error("Pass exactly one of --approve or --reject.");
  }
  const proposal = await reviewImprovementProposal({
    ...resolveContext(deps),
    proposalId,
    approved: Boolean(opts.approve),
    reviewer: opts.reviewer,
    comments: opts.comments,
  });
  if (opts.json) {
    printJson(runtime, { proposal });
    return;
  }
  runtime.log(`Improvement proposal ${proposal.id}: ${proposal.status}`);
}

export async function runImproveApplyCommand(
  proposalId: string,
  opts: ImproveJsonOption,
  runtime: RuntimeEnv | OutputRuntimeEnv,
  deps: ImproveRuntimeDeps = defaultImproveRuntimeDeps,
): Promise<void> {
  const proposal = await applyImprovementProposal({
    ...resolveContext(deps),
    proposalId,
    config: deps.loadConfig(),
  });
  if (opts.json) {
    printJson(runtime, { proposal });
    return;
  }
  runtime.log(`Improvement proposal ${proposal.id}: ${proposal.status}`);
}

export async function runImproveVerifyCommand(
  proposalId: string,
  opts: ImproveJsonOption,
  runtime: RuntimeEnv | OutputRuntimeEnv,
  deps: ImproveRuntimeDeps = defaultImproveRuntimeDeps,
): Promise<void> {
  const proposal = await verifyImprovementProposal({
    ...resolveContext(deps),
    proposalId,
    config: deps.loadConfig(),
  });
  if (opts.json) {
    printJson(runtime, { proposal });
    return;
  }
  runtime.log(
    `Improvement proposal ${proposal.id}: ${proposal.verificationResult?.passed ? "verified" : "failed"}`,
  );
}

export async function runImproveRollbackCommand(
  proposalId: string,
  opts: ImproveJsonOption,
  runtime: RuntimeEnv | OutputRuntimeEnv,
  deps: ImproveRuntimeDeps = defaultImproveRuntimeDeps,
): Promise<void> {
  const proposal = await rollbackImprovementProposal({
    ...resolveContext(deps),
    proposalId,
  });
  if (opts.json) {
    printJson(runtime, { proposal });
    return;
  }
  runtime.log(`Improvement proposal ${proposal.id}: ${proposal.status}`);
}

export async function runImproveMetricsCommand(
  opts: ImproveJsonOption,
  runtime: RuntimeEnv | OutputRuntimeEnv,
  deps: ImproveRuntimeDeps = defaultImproveRuntimeDeps,
): Promise<void> {
  const metrics = await summarizeImprovementMetrics(resolveContext(deps));
  if (opts.json) {
    printJson(runtime, { metrics });
    return;
  }
  printText(
    runtime,
    [
      `Total: ${metrics.total}`,
      `Applied: ${metrics.applied}`,
      `Approved: ${metrics.approved}`,
      `Rolled back: ${metrics.rolledBack}`,
      `Failed: ${metrics.failed}`,
      `Policy blocked: ${metrics.policyBlocked}`,
    ].join("\n"),
  );
}
