import { matchesKey, type Component, truncateToWidth } from "@mariozechner/pi-tui";
import { translateTuiText } from "../cli/i18n/tui.js";
import { loadConfig } from "../config/config.js";
import {
  applyImprovementProposal,
  getImprovementProposalDetail,
  listImprovementProposals,
  reviewImprovementProposal,
  rollbackImprovementProposal,
  runImprovementScan,
  verifyImprovementProposal,
  type ImprovementProposalDetail,
  type ImprovementProposalListItem,
} from "../improvement/center.js";
import { theme } from "./theme/theme.js";

export type ImprovementOverlayAction = "approve" | "reject" | "apply" | "verify" | "rollback";

export type TuiImprovementApi = {
  list: () => Promise<ImprovementProposalListItem[]>;
  detail: (proposalId: string) => Promise<ImprovementProposalDetail>;
  run: () => Promise<{ run: { runId: string; status: string }; proposal?: { id: string } }>;
  review: (proposalId: string, approved: boolean) => Promise<{ id: string; status: string }>;
  apply: (proposalId: string) => Promise<{ id: string; status: string }>;
  verify: (proposalId: string) => Promise<{ id: string; status: string }>;
  rollback: (proposalId: string) => Promise<{ id: string; status: string }>;
};

export function createDefaultTuiImprovementApi(workspaceDir = process.cwd()): TuiImprovementApi {
  return {
    list: async () => await listImprovementProposals({ workspaceDir }, { limit: 50 }),
    detail: async (proposalId) => await getImprovementProposalDetail({ workspaceDir }, proposalId),
    run: async () =>
      await runImprovementScan({
        workspaceDir,
        config: loadConfig(),
      }),
    review: async (proposalId, approved) =>
      await reviewImprovementProposal({
        workspaceDir,
        proposalId,
        approved,
        reviewer: "tui",
      }),
    apply: async (proposalId) =>
      await applyImprovementProposal({
        workspaceDir,
        proposalId,
        config: loadConfig(),
      }),
    verify: async (proposalId) =>
      await verifyImprovementProposal({
        workspaceDir,
        proposalId,
        config: loadConfig(),
      }),
    rollback: async (proposalId) => await rollbackImprovementProposal({ workspaceDir, proposalId }),
  };
}

function patchSummary(detail: ImprovementProposalDetail): string {
  const proposal = detail.proposal;
  if (proposal.patchPlan.kind === "skill") {
    return `skill ${proposal.patchPlan.targetDir}/${proposal.patchPlan.skillName}/SKILL.md`;
  }
  if (proposal.patchPlan.kind === "workflow") {
    return `workflow ${proposal.patchPlan.patch.mode} ${proposal.patchPlan.workflowRef ?? "new"}`;
  }
  return `code ${proposal.patchPlan.summary}`;
}

export function formatImprovementProposalOverlayLines(detail: ImprovementProposalDetail): string[] {
  const proposal = detail.proposal;
  return [
    translateTuiText("tui.improve.detailTitle", { id: proposal.id }),
    `${translateTuiText("tui.improve.status")}: ${proposal.status}`,
    `${translateTuiText("tui.improve.kind")}: ${proposal.patchPlan.kind}`,
    `${translateTuiText("tui.improve.risk")}: ${proposal.verdict.riskLevel}`,
    `${translateTuiText("tui.improve.confidence")}: ${proposal.verdict.confidence}`,
    `${translateTuiText("tui.improve.actions")}: ${detail.availableActions.join(", ") || "none"}`,
    "",
    translateTuiText("tui.improve.signal"),
    proposal.candidate.signalSummary,
    "",
    translateTuiText("tui.improve.patch"),
    patchSummary(detail),
    "",
    translateTuiText("tui.improve.evidence"),
    ...detail.evidenceRefs.map((ref) => `- ${ref.kind}:${ref.ref}`),
    "",
    translateTuiText("tui.improve.keys"),
  ];
}

export class ImprovementProposalOverlayComponent implements Component {
  constructor(
    private readonly detail: ImprovementProposalDetail,
    private readonly callbacks: {
      onClose: () => void;
      onBack: () => void;
      onAction: (action: ImprovementOverlayAction) => void | Promise<void>;
    },
  ) {}

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 4);
    return formatImprovementProposalOverlayLines(this.detail).map((line, index) => {
      const text = truncateToWidth(line, innerWidth, "…");
      if (index === 0) {
        return theme.header(text);
      }
      return theme.dim(text);
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "\u0003") {
      this.callbacks.onClose();
      return;
    }
    if (data === "b") {
      this.callbacks.onBack();
      return;
    }
    const actions: Record<string, ImprovementOverlayAction> = {
      a: "approve",
      r: "reject",
      p: "apply",
      v: "verify",
      z: "rollback",
    };
    const action = actions[data];
    if (action) {
      void this.callbacks.onAction(action);
    }
  }

  invalidate(): void {}
}
