import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkspaceSkillEntries } from "../agents/skills/workspace.js";
import { upsertExperienceIndexEntryFromNote } from "../memory/experience/index-store.ts";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { describeWorkflow, listWorkflowVersions } from "../workflows/registry.js";
import {
  applyImprovementProposal,
  reviewImprovementProposal,
  runImprovementWorkflow,
} from "./runner.js";
import {
  loadImprovementProposal,
  loadImprovementRunRecord,
  loadImprovementStoreIndex,
} from "./store.js";
import type { PromotionVerdict } from "./types.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

async function seedRepeatedExperience(): Promise<void> {
  await upsertExperienceIndexEntryFromNote({
    note: {
      type: "workflow_pattern",
      title: "workflow 排查顺序 A",
      summary: "排查 workflow 时先查 registry，再查 operations，再看 executions。",
      context: "workflow 执行失败。",
      trigger: "workflow 执行异常。",
      action: "先查 registry，再查 operations，再看 executions。",
      result: "定位问题更快。",
      lesson: "先看结构定义，再看运行记录。",
      evidence: ["这次排障按这个顺序定位到了问题。"],
      confidence: "high",
      dedupeKey: "workflow-order-a",
    },
    notebookId: "local",
  });

  await upsertExperienceIndexEntryFromNote({
    note: {
      type: "workflow_pattern",
      title: "workflow 排查顺序 B",
      summary: "处理 workflow 问题时先查 registry，再查 operations，再看 executions。",
      context: "workflow 更新后异常。",
      trigger: "workflow 更新异常。",
      action: "先查 registry，再查 operations，再看 executions。",
      result: "更快定位定义与执行偏差。",
      lesson: "定义和执行要分开看。",
      evidence: ["另一次修复也按这条顺序成功。"],
      confidence: "high",
      dedupeKey: "workflow-order-b",
    },
    notebookId: "local",
  });
}

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
      await seedRepeatedExperience();

      const result = await runImprovementWorkflow({
        workspaceDir,
        judge: async ({ candidate }) => buildSkillVerdict(candidate.id),
      });

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
    });
  });

  it("creates a local embedded judge context when no parent context is supplied", async () => {
    await withStateDirEnv("crawclaw-improvement-runner-", async () => {
      const workspaceDir = await tempDirs.make("improvement-runner-local-context-");
      const config = {} as never;
      await seedRepeatedExperience();

      let observedContext:
        | Parameters<typeof runImprovementWorkflow>[0]["embeddedJudgeContext"]
        | undefined;
      const result = await runImprovementWorkflow(
        {
          workspaceDir,
          config,
        },
        {
          runPromotionJudge: async ({ candidate, embeddedContext }) => {
            observedContext = embeddedContext;
            return buildSkillVerdict(candidate.id);
          },
        },
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
      await seedRepeatedExperience();

      const result = await runImprovementWorkflow({
        workspaceDir,
        judge: async ({ candidate }) => buildSkillVerdict(candidate.id),
      });

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
      await seedRepeatedExperience();

      const result = await runImprovementWorkflow({
        workspaceDir,
        judge: async ({ candidate }) => buildSkillVerdict(candidate.id),
      });
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
      await seedRepeatedExperience();

      const result = await runImprovementWorkflow({
        workspaceDir,
        judge: async ({ candidate }) => buildWorkflowVerdict(candidate.id),
      });
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
      await seedRepeatedExperience();
      const result = await runImprovementWorkflow({
        workspaceDir,
        judge: async ({ candidate }) => ({
          ...buildSkillVerdict(candidate.id),
          reusableMethod: "生成一个格式错误的 skill。",
        }),
      });

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
