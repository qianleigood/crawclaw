import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkspaceSkillEntries } from "../agents/skills/workspace.js";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { describeWorkflow, listWorkflowVersions } from "../workflows/registry.js";
import {
  applyImprovementProposal,
  reviewImprovementProposal,
  runImprovementWorkflow,
  type ImprovementWorkflowDeps,
} from "./runner.js";
import {
  loadImprovementProposal,
  loadImprovementRunRecord,
  loadImprovementStoreIndex,
  resolveImprovementRunPath,
} from "./store.js";
import type { PromotionCandidateAssessment, PromotionVerdict } from "./types.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

function buildSkillVerdict(candidateId: string): PromotionVerdict {
  return {
    candidateId,
    decision: "propose_skill",
    confidence: "high",
    riskLevel: "low",
    targetScope: "workspace",
    triggerPattern: "workflow 执行异常",
    reusableMethod: "先查 registry，再查 operations，再看 executions。",
    reasonsFor: ["重复出现", "步骤已经稳定"],
    reasonsAgainst: [],
    missingEvidence: [],
    verificationPlan: ["验证 SKILL frontmatter", "验证 discoverSkillsForTask 命中"],
  };
}

function buildCandidateAssessment(): PromotionCandidateAssessment {
  return {
    candidate: {
      id: "notebooklm-candidate:workflow-order",
      sourceRefs: [{ kind: "experience", ref: "note-workflow-order" }],
      signalSummary: "workflow 排查反复使用 registry -> operations -> executions 的顺序。",
      observedFrequency: 2,
      currentReuseLevel: "experience",
      triggerPattern: "workflow 执行异常",
      repeatedActions: ["先查 registry，再查 operations，再看 executions。"],
      validationEvidence: ["两次排障都按这个顺序定位问题。"],
      firstSeenAt: 100,
      lastSeenAt: 200,
    },
    evidenceKinds: ["trigger", "action", "result", "validation"],
    baselineDecision: "ready",
    blockers: [],
    score: 42,
  };
}

function buildWorkflowDeps(
  overrides: Partial<ImprovementWorkflowDeps> = {},
): ImprovementWorkflowDeps {
  return {
    buildPromotionCandidateAssessments: async () => [buildCandidateAssessment()],
    runPromotionJudge: async ({ candidate }) => buildSkillVerdict(candidate.id),
    ...overrides,
  };
}

function buildWorkflowVerdict(candidateId: string): PromotionVerdict {
  return {
    candidateId,
    decision: "propose_workflow",
    confidence: "high",
    riskLevel: "medium",
    targetScope: "workspace",
    triggerPattern: "workflow 需要重复人工排查",
    reusableMethod: "把排查顺序沉淀成一个可运行 workflow。",
    reasonsFor: ["重复出现", "步骤稳定"],
    reasonsAgainst: [],
    missingEvidence: [],
    verificationPlan: ["验证 workflow draft", "验证 version snapshot"],
  };
}

describe("improvement runner", () => {
  it("builds a pending review proposal from experience without mutating workspace files", async () => {
    await withStateDirEnv("crawclaw-improvement-runner-", async () => {
      const workspaceDir = await tempDirs.make("improvement-runner-pending-");

      const result = await runImprovementWorkflow(
        {
          workspaceDir,
          judge: async ({ candidate }) => buildSkillVerdict(candidate.id),
        },
        buildWorkflowDeps(),
      );

      expect(result.proposal).toBeTruthy();
      expect(result.proposal?.status).toBe("pending_review");
      await expect(fs.stat(path.join(workspaceDir, ".agents", "skills"))).rejects.toMatchObject({
        code: "ENOENT",
      });

      const store = await loadImprovementStoreIndex({ workspaceDir });
      expect(store.proposals).toHaveLength(1);
      expect(store.proposals[0]?.status).toBe("pending_review");

      const run = await loadImprovementRunRecord({ workspaceDir }, result.run.runId);
      expect(run?.status).toBe("pending_review");
      expect(
        path.basename(resolveImprovementRunPath({ workspaceDir }, result.run.runId)),
      ).not.toMatch(/[:<>"/\\|?*]/);
    });
  });

  it("creates a local embedded judge context when no parent context is supplied", async () => {
    await withStateDirEnv("crawclaw-improvement-runner-", async () => {
      const workspaceDir = await tempDirs.make("improvement-runner-local-context-");
      const config = {} as never;

      let observedContext:
        | Parameters<typeof runImprovementWorkflow>[0]["embeddedJudgeContext"]
        | undefined;
      const result = await runImprovementWorkflow(
        {
          workspaceDir,
          config,
        },
        buildWorkflowDeps({
          runPromotionJudge: async ({ candidate, embeddedContext }) => {
            observedContext = embeddedContext;
            return buildSkillVerdict(candidate.id);
          },
        }),
      );

      expect(result.proposal?.status).toBe("pending_review");
      expect(observedContext).toMatchObject({
        workspaceDir,
        agentId: "main",
        spawnedBy: "improvement-center",
        config,
      });
      expect(observedContext?.sessionId).toMatch(/^improvement-center-/);
      expect(observedContext?.sessionFile).toContain(
        path.join(".crawclaw", "improvements", "runs"),
      );
    });
  });

  it("refuses to apply proposals before approval", async () => {
    await withStateDirEnv("crawclaw-improvement-runner-", async () => {
      const workspaceDir = await tempDirs.make("improvement-runner-unapproved-");

      const result = await runImprovementWorkflow(
        {
          workspaceDir,
          judge: async ({ candidate }) => buildSkillVerdict(candidate.id),
        },
        buildWorkflowDeps(),
      );

      await expect(
        applyImprovementProposal({
          workspaceDir,
          proposalId: result.proposal!.id,
        }),
      ).rejects.toThrow("approved review");
    });
  });

  it("applies approved skill proposals into workspace .agents/skills", async () => {
    await withStateDirEnv("crawclaw-improvement-runner-", async () => {
      const workspaceDir = await tempDirs.make("improvement-runner-skill-");

      const result = await runImprovementWorkflow(
        {
          workspaceDir,
          judge: async ({ candidate }) => buildSkillVerdict(candidate.id),
        },
        buildWorkflowDeps(),
      );
      await reviewImprovementProposal({
        workspaceDir,
        proposalId: result.proposal!.id,
        approved: true,
        reviewer: "maintainer",
      });

      const applied = await applyImprovementProposal({
        workspaceDir,
        proposalId: result.proposal!.id,
      });
      const skillName =
        applied.patchPlan.kind === "skill" ? applied.patchPlan.skillName : "unexpected";

      expect(applied.status).toBe("applied");
      expect(applied.verificationResult?.passed).toBe(true);
      await expect(
        fs.readFile(path.join(workspaceDir, ".agents", "skills", skillName, "SKILL.md"), "utf8"),
      ).resolves.toContain(`name: ${skillName}`);

      const entries = loadWorkspaceSkillEntries(workspaceDir);
      expect(entries.map((entry) => entry.skill.name)).toContain(skillName);
    });
  });

  it("applies approved workflow proposals through the registry and saves versions", async () => {
    await withStateDirEnv("crawclaw-improvement-runner-", async () => {
      const workspaceDir = await tempDirs.make("improvement-runner-workflow-");

      const result = await runImprovementWorkflow(
        {
          workspaceDir,
          judge: async ({ candidate }) => buildWorkflowVerdict(candidate.id),
        },
        buildWorkflowDeps(),
      );
      await reviewImprovementProposal({
        workspaceDir,
        proposalId: result.proposal!.id,
        approved: true,
        reviewer: "maintainer",
      });

      const applied = await applyImprovementProposal({
        workspaceDir,
        proposalId: result.proposal!.id,
      });

      expect(applied.status).toBe("applied");
      expect(applied.verificationResult?.passed).toBe(true);
      expect(applied.patchPlan).toMatchObject({
        kind: "workflow",
        workflowRef: expect.stringMatching(/^wf_/),
      });

      const described = await describeWorkflow(
        { workspaceDir },
        (applied.patchPlan as { kind: "workflow"; workflowRef: string }).workflowRef,
      );
      expect(described?.entry.safeForAutoRun).toBe(false);
      expect(described?.entry.requiresApproval).toBe(true);

      const versions = await listWorkflowVersions(
        { workspaceDir },
        (applied.patchPlan as { kind: "workflow"; workflowRef: string }).workflowRef,
      );
      expect(versions?.specVersions.length).toBeGreaterThan(0);
    });
  });

  it("marks invalid skill proposals as failed and keeps rollback guidance", async () => {
    const workspaceDir = await tempDirs.make("improvement-runner-failed-");

    await withStateDirEnv("crawclaw-improvement-runner-", async () => {
      const result = await runImprovementWorkflow(
        {
          workspaceDir,
          judge: async ({ candidate }) => ({
            ...buildSkillVerdict(candidate.id),
            reusableMethod: "生成一个格式错误的 skill。",
          }),
        },
        buildWorkflowDeps(),
      );

      const proposal = await loadImprovementProposal({ workspaceDir }, result.proposal!.id);
      expect(proposal).toBeTruthy();
      await reviewImprovementProposal({
        workspaceDir,
        proposalId: result.proposal!.id,
        approved: true,
        reviewer: "maintainer",
      });

      const broken = await applyImprovementProposal({
        workspaceDir,
        proposalId: result.proposal!.id,
        overrideMarkdown: "# missing frontmatter\n",
      });

      expect(broken.status).toBe("failed");
      expect(broken.rollbackPlan.length).toBeGreaterThan(0);
      expect(broken.verificationResult?.passed).toBe(false);
    });
  });
});
