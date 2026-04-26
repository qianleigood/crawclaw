import { afterEach, describe, expect, it } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/index.js";
import type { ImprovementProposalDetail } from "../improvement/center.js";
import { formatImprovementProposalOverlayLines } from "./tui-improvement-center.js";

const detail: ImprovementProposalDetail = {
  proposal: {
    id: "proposal-1",
    status: "pending_review",
    candidate: {
      id: "candidate-1",
      sourceRefs: [{ kind: "experience", ref: "exp-1" }],
      signalSummary: "Repeated workflow diagnosis",
      observedFrequency: 2,
      currentReuseLevel: "experience",
      repeatedActions: ["Check registry"],
      validationEvidence: ["Validated"],
      firstSeenAt: 1,
      lastSeenAt: 2,
    },
    verdict: {
      candidateId: "candidate-1",
      decision: "propose_skill",
      confidence: "high",
      riskLevel: "low",
      reasonsFor: ["Stable"],
      reasonsAgainst: [],
      missingEvidence: [],
      verificationPlan: ["Verify"],
    },
    patchPlan: {
      kind: "skill",
      targetDir: ".agents/skills",
      skillName: "workflow-diagnosis",
      markdown: "skill",
    },
    policyResult: { allowed: true, blockers: [] },
    rollbackPlan: ["Delete skill"],
    createdAt: 1,
    updatedAt: 2,
  },
  evidenceRefs: [{ kind: "experience", ref: "exp-1" }],
  policyBlockers: [],
  availableActions: ["approve", "reject"],
};

describe("tui improvement center", () => {
  afterEach(() => {
    setActiveCliLocale("en");
  });

  it("localizes improvement proposal metadata in zh-CN", () => {
    setActiveCliLocale("zh-CN");

    const lines = formatImprovementProposalOverlayLines(detail);

    expect(lines).toContain("状态: 待审核");
    expect(lines).toContain("类型: 技能");
    expect(lines).toContain("风险: 低");
    expect(lines).toContain("置信度: 高");
    expect(lines).toContain("可用操作: 批准, 拒绝");
    expect(lines).toContain("技能 .agents/skills/workflow-diagnosis/SKILL.md");
    expect(lines.join("\n")).not.toContain("pending_review");
    expect(lines.join("\n")).not.toContain("approve, reject");
  });
});
