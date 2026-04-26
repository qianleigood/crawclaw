import { describe, expect, it } from "vitest";
import { applyImprovementPolicy } from "./policy.js";
import type { ImprovementProposal, PromotionCandidate, PromotionVerdict } from "./types.js";

function makeCandidate(): PromotionCandidate {
  return {
    id: "candidate-1",
    sourceRefs: [{ kind: "experience", ref: "experience-index:gateway" }],
    signalSummary: "Gateway 发布失败时总是先回滚 service，再检查 secret。",
    observedFrequency: 2,
    currentReuseLevel: "experience",
    triggerPattern: "发布失败且健康检查异常",
    repeatedActions: ["先回滚 service，再检查 secret。"],
    validationEvidence: ["两次排障都验证成功。"],
    firstSeenAt: 1,
    lastSeenAt: 2,
  };
}

function makeVerdict(overrides: Partial<PromotionVerdict> = {}): PromotionVerdict {
  return {
    candidateId: "candidate-1",
    decision: "propose_skill",
    confidence: "high",
    riskLevel: "low",
    targetScope: "workspace",
    triggerPattern: "发布失败且健康检查异常",
    reusableMethod: "先回滚 service，再检查 secret。",
    reasonsFor: ["重复出现"],
    reasonsAgainst: [],
    missingEvidence: [],
    verificationPlan: ["验证 skill frontmatter", "验证 skill discovery 命中"],
    ...overrides,
  };
}

function makeProposal(overrides: Partial<ImprovementProposal> = {}): ImprovementProposal {
  return {
    id: "proposal-1",
    status: "draft",
    candidate: makeCandidate(),
    verdict: makeVerdict(),
    patchPlan: {
      kind: "skill",
      targetDir: ".agents/skills",
      skillName: "gateway-release-order",
      markdown:
        "---\nname: gateway-release-order\ndescription: Use when gateway release fails.\n---\n",
    },
    rollbackPlan: ["删除 .agents/skills/gateway-release-order/SKILL.md"],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("applyImprovementPolicy", () => {
  it("allows workspace .agents/skills proposals to auto-apply", () => {
    const proposal = applyImprovementPolicy(makeProposal());

    expect(proposal.policyResult).toEqual({
      allowed: true,
      blockers: [],
    });
  });

  it("blocks repo-bundled skills from automatic apply", () => {
    const proposal = applyImprovementPolicy(
      makeProposal({
        patchPlan: {
          kind: "skill",
          targetDir: "skills",
          skillName: "bundled-skill",
          markdown: "---\nname: bundled-skill\ndescription: bundled.\n---\n",
        },
      }),
    );

    expect(proposal.policyResult?.allowed).toBe(false);
    expect(proposal.policyResult?.blockers).toEqual(
      expect.arrayContaining(["repo_bundled_skills_require_manual_promotion"]),
    );
  });

  it("forces workflow proposals to require approval and disable auto-run", () => {
    const proposal = applyImprovementPolicy(
      makeProposal({
        verdict: makeVerdict({ decision: "propose_workflow", riskLevel: "medium" }),
        patchPlan: {
          kind: "workflow",
          patch: {
            mode: "create",
            draft: {
              name: "Gateway Recovery",
              goal: "Recover gateway after failed deploy",
              safeForAutoRun: true,
              requiresApproval: false,
              stepSpecs: [{ title: "Recover gateway" }],
            },
          },
        },
      }),
    );

    expect(proposal.policyResult?.allowed).toBe(true);
    expect(proposal.patchPlan).toMatchObject({
      kind: "workflow",
      patch: {
        mode: "create",
        draft: {
          safeForAutoRun: false,
          requiresApproval: true,
        },
      },
    });
  });

  it("never allows code proposals to auto-apply", () => {
    const proposal = applyImprovementPolicy(
      makeProposal({
        verdict: makeVerdict({
          decision: "propose_code",
          riskLevel: "high",
        }),
        patchPlan: {
          kind: "code",
          summary: "Patch workflow compiler to avoid repeated manual fixes.",
          recommendedWorktree: true,
        },
      }),
    );

    expect(proposal.policyResult?.allowed).toBe(false);
    expect(proposal.policyResult?.blockers).toEqual(
      expect.arrayContaining(["code_improvement_requires_isolated_manual_flow"]),
    );
  });
});
