import { describe, expect, it } from "vitest";
import type { ImprovementProposalDetail, ImprovementProposalListItem } from "./center.js";
import type { ImprovementProposal } from "./types.js";
import {
  buildImprovementDetailView,
  buildImprovementListViewItem,
  mapImprovementCenterError,
} from "./view-model.js";

const now = 1_777_185_000_000;

function baseCandidate(): ImprovementProposal["candidate"] {
  return {
    id: "candidate-release",
    sourceRefs: [{ kind: "experience", ref: "exp-release-1" }],
    signalSummary: "Repeated release checklist before publishing",
    observedFrequency: 4,
    currentReuseLevel: "experience",
    triggerPattern: "before npm release",
    repeatedActions: ["run build", "run release checks"],
    validationEvidence: ["postpublish verify passed"],
    firstSeenAt: now - 1000,
    lastSeenAt: now,
  };
}

function baseVerdict(): ImprovementProposal["verdict"] {
  return {
    candidateId: "candidate-release",
    decision: "propose_skill",
    confidence: "high",
    riskLevel: "low",
    targetScope: "workspace",
    triggerPattern: "before npm release",
    reusableMethod: "Run build, release checks, and postpublish verification.",
    reasonsFor: ["Repeated 4 times", "Has validation evidence"],
    reasonsAgainst: [],
    missingEvidence: [],
    verificationPlan: ["Load skill", "Run skill discovery"],
  };
}

function skillProposal(overrides: Partial<ImprovementProposal> = {}): ImprovementProposal {
  return {
    id: "proposal-release-skill",
    status: "pending_review",
    candidate: baseCandidate(),
    verdict: baseVerdict(),
    patchPlan: {
      kind: "skill",
      targetDir: ".agents/skills",
      skillName: "release-checklist",
      markdown: "# Release checklist\n\nRun the release checks.",
    },
    policyResult: { allowed: true, blockers: [] },
    rollbackPlan: ["Delete .agents/skills/release-checklist/SKILL.md"],
    createdAt: now - 500,
    updatedAt: now,
    ...overrides,
  };
}

function detailFor(proposal: ImprovementProposal): ImprovementProposalDetail {
  return {
    proposal,
    evidenceRefs: proposal.candidate.sourceRefs,
    policyBlockers: proposal.policyResult?.blockers ?? [],
    availableActions: ["show", "approve", "reject"],
  };
}

describe("improvement view models", () => {
  it("maps list items to beginner-readable labels", () => {
    const item: ImprovementProposalListItem = {
      id: "proposal-release-skill",
      candidateId: "candidate-release",
      kind: "skill",
      status: "pending_review",
      signalSummary: "Repeated release checklist before publishing",
      decision: "propose_skill",
      riskLevel: "low",
      confidence: "high",
      createdAt: now - 500,
      updatedAt: now,
    };

    expect(buildImprovementListViewItem(item)).toMatchObject({
      id: "proposal-release-skill",
      title: "Suggested Skill: Repeated release checklist before publishing",
      kindLabel: "Suggested Skill",
      statusLabel: "Needs review",
      riskLabel: "Low risk",
      confidenceLabel: "High confidence",
    });
  });

  it("puts plain-language summary before technical details", () => {
    const proposal = skillProposal();

    expect(buildImprovementDetailView(detailFor(proposal))).toMatchObject({
      id: "proposal-release-skill",
      title: "Suggested Skill: Repeated release checklist before publishing",
      plainSummary: "CrawClaw suggests creating a Skill from a repeated, validated pattern.",
      safetySummary: "Low risk. Policy allows this proposal.",
      changeSummary: "Create workspace skill .agents/skills/release-checklist/SKILL.md.",
      availableActions: expect.arrayContaining(["approve", "reject"]),
    });
  });

  it("builds workflow patch previews from registry patch metadata", () => {
    const proposal = skillProposal({
      verdict: { ...baseVerdict(), decision: "propose_workflow", riskLevel: "medium" },
      patchPlan: {
        kind: "workflow",
        workflowRef: "release-checks",
        patch: {
          mode: "update",
          workflowRef: "release-checks",
          patch: { description: "Run release checks before publishing." },
        },
      },
      rollbackPlan: ["Rollback workflow release-checks to the previous version"],
    });

    const view = buildImprovementDetailView(detailFor(proposal));
    expect(view.kindLabel).toBe("Suggested Workflow");
    expect(view.changeSummary).toBe(
      "Update workflow release-checks through the workflow registry.",
    );
    expect(view.patchPreview.lines).toEqual(
      expect.arrayContaining([
        "Target: release-checks",
        "Mode: update",
        "requiresApproval: true",
        "safeForAutoRun: false",
      ]),
    );
  });

  it("keeps empty evidence readable", () => {
    const proposal = skillProposal({
      candidate: {
        ...baseCandidate(),
        sourceRefs: [],
        repeatedActions: [],
        validationEvidence: [],
      },
    });

    expect(buildImprovementDetailView(detailFor(proposal)).evidenceItems).toEqual([
      { label: "evidence", value: "No evidence references were recorded." },
      { label: "validation", value: "No validation evidence was recorded." },
    ]);
  });

  it("disables code proposal actions with clear explanations", () => {
    const proposal = skillProposal({
      verdict: { ...baseVerdict(), decision: "propose_code", riskLevel: "medium" },
      patchPlan: {
        kind: "code",
        summary: "Refactor repeated release validation into a shared helper.",
        recommendedWorktree: true,
      },
    });

    const view = buildImprovementDetailView({
      ...detailFor(proposal),
      availableActions: ["show"],
    });
    expect(view.kindLabel).toBe("Code Change Proposal");
    expect(view.disabledActions).toEqual(
      expect.arrayContaining([
        {
          action: "apply",
          reason: "Code proposals require a manual isolated worktree and review.",
        },
        {
          action: "verify",
          reason: "Code proposals must be verified through the manual code review flow.",
        },
      ]),
    );
  });

  it("maps known center errors to short user messages", () => {
    expect(mapImprovementCenterError("review_required")).toEqual({
      title: "Approval required",
      message: "Approve this proposal before applying it.",
    });
  });
});
