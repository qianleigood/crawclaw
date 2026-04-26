import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { createWorkflowDraft, describeWorkflow } from "../workflows/registry.js";
import {
  applyImprovementProposal,
  getImprovementProposalDetail,
  ImprovementCenterError,
  listImprovementProposals,
  rollbackImprovementProposal,
  summarizeImprovementMetrics,
} from "./center.js";
import { applyImprovementPolicy } from "./policy.js";
import { reviewImprovementProposal, runImprovementWorkflow } from "./runner.js";
import { saveImprovementProposal } from "./store.js";
import type { ImprovementProposal, PromotionVerdict } from "./types.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

function buildVerdict(candidateId: string): PromotionVerdict {
  return {
    candidateId,
    decision: "propose_skill",
    confidence: "high",
    riskLevel: "low",
    targetScope: "workspace",
    triggerPattern: "workflow issue repeats",
    reusableMethod: "Check registry, operations, and executions in order.",
    reasonsFor: ["Repeated issue", "Stable procedure"],
    reasonsAgainst: [],
    missingEvidence: [],
    verificationPlan: ["Validate the generated skill"],
  };
}

function buildProposal(params: {
  id: string;
  status: ImprovementProposal["status"];
  kind: ImprovementProposal["patchPlan"]["kind"];
  updatedAt: number;
}): ImprovementProposal {
  return {
    id: params.id,
    status: params.status,
    candidate: {
      id: `candidate-${params.id}`,
      sourceRefs: [{ kind: "experience", ref: `exp-${params.id}` }],
      signalSummary: `Signal ${params.id}`,
      observedFrequency: 2,
      currentReuseLevel: "experience",
      triggerPattern: "repeat trigger",
      repeatedActions: ["Do the stable action"],
      validationEvidence: ["Validated once"],
      firstSeenAt: params.updatedAt - 10,
      lastSeenAt: params.updatedAt,
    },
    verdict: {
      ...buildVerdict(`candidate-${params.id}`),
      decision:
        params.kind === "workflow"
          ? "propose_workflow"
          : params.kind === "code"
            ? "propose_code"
            : "propose_skill",
    },
    patchPlan:
      params.kind === "skill"
        ? {
            kind: "skill",
            targetDir: ".agents/skills",
            skillName: `skill-${params.id}`,
            markdown: [
              "---",
              `name: skill-${params.id}`,
              "description: Use when workflow issue repeats.",
              "---",
              "",
              "# Skill",
            ].join("\n"),
          }
        : params.kind === "workflow"
          ? {
              kind: "workflow",
              patch: {
                mode: "create",
                draft: {
                  name: `Workflow ${params.id}`,
                  goal: "Run the stable action",
                  safeForAutoRun: false,
                  requiresApproval: true,
                },
              },
            }
          : {
              kind: "code",
              summary: "Manual code improvement only.",
              recommendedWorktree: true,
            },
    policyResult: {
      allowed: params.kind !== "code",
      blockers: params.kind === "code" ? ["code"] : [],
    },
    rollbackPlan: ["Rollback the applied artifact."],
    createdAt: params.updatedAt - 10,
    updatedAt: params.updatedAt,
  };
}

async function seedRepeatedExperience(): Promise<void> {
  const { upsertExperienceIndexEntryFromNote } =
    await import("../memory/experience/index-store.ts");
  for (const suffix of ["a", "b"]) {
    await upsertExperienceIndexEntryFromNote({
      note: {
        type: "workflow_pattern",
        title: `workflow diagnosis ${suffix}`,
        summary: "Check registry, operations, and executions in order.",
        context: "Workflow failed.",
        trigger: "Workflow issue repeats.",
        action: "Check registry, operations, and executions in order.",
        result: "Issue was found faster.",
        lesson: "Definition and execution evidence should be separated.",
        evidence: [`validated ${suffix}`],
        confidence: "high",
        dedupeKey: `improvement-center-${suffix}`,
      },
      notebookId: "local",
    });
  }
}

describe("Improvement Center", () => {
  it("lists proposals newest first and exposes detail actions", async () => {
    const workspaceDir = await tempDirs.make("improvement-center-list-");
    await saveImprovementProposal(
      { workspaceDir },
      buildProposal({ id: "old", status: "approved", kind: "skill", updatedAt: 100 }),
    );
    await saveImprovementProposal(
      { workspaceDir },
      buildProposal({ id: "new", status: "pending_review", kind: "workflow", updatedAt: 200 }),
    );

    const list = await listImprovementProposals({ workspaceDir });
    expect(list.map((entry) => entry.id)).toEqual(["new", "old"]);

    const detail = await getImprovementProposalDetail({ workspaceDir }, "new");
    expect(detail.evidenceRefs).toEqual([{ kind: "experience", ref: "exp-new" }]);
    expect(detail.availableActions).toContain("approve");
  });

  it("blocks code proposals from automatic apply", async () => {
    const workspaceDir = await tempDirs.make("improvement-center-code-");
    const proposal = buildProposal({
      id: "code",
      status: "approved",
      kind: "code",
      updatedAt: Date.now(),
    });
    await saveImprovementProposal(
      { workspaceDir },
      {
        ...proposal,
        review: { approved: true },
      },
    );

    await expect(
      applyImprovementProposal({ workspaceDir, proposalId: proposal.id }),
    ).rejects.toMatchObject({
      code: "apply_not_supported",
    } satisfies Partial<ImprovementCenterError>);
  });

  it("applies and rolls back a generated workspace skill", async () => {
    await withStateDirEnv("crawclaw-improvement-center-", async () => {
      const workspaceDir = await tempDirs.make("improvement-center-skill-");
      await seedRepeatedExperience();
      const result = await runImprovementWorkflow({
        workspaceDir,
        judge: async ({ candidate }) => buildVerdict(candidate.id),
      });
      await reviewImprovementProposal({
        workspaceDir,
        proposalId: result.proposal!.id,
        approved: true,
      });

      const applied = await applyImprovementProposal({
        workspaceDir,
        proposalId: result.proposal!.id,
      });
      expect(applied.status).toBe("applied");
      expect(applied.application).toMatchObject({ kind: "skill", created: true });
      if (applied.application?.kind !== "skill") {
        throw new Error("Expected a skill application.");
      }

      const rolledBack = await rollbackImprovementProposal({
        workspaceDir,
        proposalId: result.proposal!.id,
      });
      expect(rolledBack.status).toBe("rolled_back");
      expect(rolledBack.rollback?.success).toBe(true);
      await expect(
        fs.stat(path.join(workspaceDir, applied.application.relativePath)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("rolls workflow updates back to the previous spec version", async () => {
    const workspaceDir = await tempDirs.make("improvement-center-workflow-");
    const created = await createWorkflowDraft({
      workspaceDir,
      name: "Original workflow",
      goal: "Original goal",
      stepSpecs: [{ title: "Original step", goal: "Original step" }],
      safeForAutoRun: false,
      requiresApproval: true,
    });
    const proposal = applyImprovementPolicy({
      ...buildProposal({
        id: "workflow-update",
        status: "approved",
        kind: "workflow",
        updatedAt: Date.now(),
      }),
      review: { approved: true },
      patchPlan: {
        kind: "workflow",
        workflowRef: created.entry.workflowId,
        patch: {
          mode: "update",
          workflowRef: created.entry.workflowId,
          patch: {
            name: "Updated workflow",
            goal: "Updated goal",
          },
        },
      },
    });
    await saveImprovementProposal({ workspaceDir }, { ...proposal, status: "approved" });

    const applied = await applyImprovementProposal({
      workspaceDir,
      proposalId: proposal.id,
    });
    expect(applied.application).toMatchObject({
      kind: "workflow",
      created: false,
      previousSpecVersion: 1,
    });
    expect((await describeWorkflow({ workspaceDir }, created.entry.workflowId))?.spec?.name).toBe(
      "Updated workflow",
    );

    const rolledBack = await rollbackImprovementProposal({
      workspaceDir,
      proposalId: proposal.id,
    });
    expect(rolledBack.status).toBe("rolled_back");
    expect((await describeWorkflow({ workspaceDir }, created.entry.workflowId))?.spec?.name).toBe(
      "Original workflow",
    );
  });

  it("summarizes proposal metrics", async () => {
    const workspaceDir = await tempDirs.make("improvement-center-metrics-");
    await saveImprovementProposal(
      { workspaceDir },
      buildProposal({ id: "a", status: "applied", kind: "skill", updatedAt: 1 }),
    );
    await saveImprovementProposal(
      { workspaceDir },
      buildProposal({ id: "b", status: "policy_blocked", kind: "code", updatedAt: 2 }),
    );

    const metrics = await summarizeImprovementMetrics({ workspaceDir });
    expect(metrics.total).toBe(2);
    expect(metrics.byKind.skill).toBe(1);
    expect(metrics.policyBlocked).toBe(1);
  });
});
