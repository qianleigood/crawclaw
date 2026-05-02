import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEmbeddedPiAgentParams } from "../agents/pi-embedded-runner/run/params.js";
import type { EmbeddedPiRunResult } from "../agents/pi-embedded-runner/types.js";
import { createCrawClawCodingTools } from "../agents/pi-tools.js";
import { runSpecialAgentToCompletion } from "../agents/special/runtime/run-once.js";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { runPromotionJudge } from "./promotion-judge.js";
import {
  applyImprovementProposal,
  reviewImprovementProposal,
  runImprovementWorkflow,
  type ImprovementWorkflowDeps,
} from "./runner.js";
import type { PromotionCandidateAssessment } from "./types.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

function buildCandidateAssessment(): PromotionCandidateAssessment {
  return {
    candidate: {
      id: "notebooklm-candidate:workflow-e2e-order",
      sourceRefs: [{ kind: "experience", ref: "note-workflow-e2e-order" }],
      signalSummary: "排查 workflow 问题时先查 registry，再查 operations，再看 executions。",
      observedFrequency: 2,
      currentReuseLevel: "experience",
      triggerPattern: "workflow 执行异常",
      repeatedActions: ["先查 registry，再查 operations，再看 executions。"],
      validationEvidence: ["两次 e2e 场景都按这个顺序定位问题。"],
      firstSeenAt: 100,
      lastSeenAt: 200,
    },
    evidenceKinds: ["trigger", "action", "result", "validation"],
    baselineDecision: "ready",
    blockers: [],
    score: 42,
  };
}

function buildWorkflowDeps(): ImprovementWorkflowDeps {
  return {
    buildPromotionCandidateAssessments: async () => [buildCandidateAssessment()],
    runPromotionJudge,
  };
}

function createEmbeddedPromotionJudgeHarness(params: { workspaceDir: string }) {
  const runEmbeddedPiAgent = vi.fn(
    async (
      embeddedParams: RunEmbeddedPiAgentParams & { __candidateId?: string },
    ): Promise<EmbeddedPiRunResult> => {
      expect(embeddedParams.specialAgentSpawnSource).toBe("promotion-judge");
      expect(embeddedParams.prompt).toContain("Submit exactly one verdict");

      const tools = createCrawClawCodingTools({
        workspaceDir: params.workspaceDir,
        sessionKey: embeddedParams.sessionKey,
        sessionId: embeddedParams.sessionId,
        runId: embeddedParams.runId,
        specialAgentSpawnSource: embeddedParams.specialAgentSpawnSource,
        agentDir: path.join(params.workspaceDir, "agent"),
      });
      const verdictTool = tools.find((tool) => tool.name === "submit_promotion_verdict");
      expect(verdictTool).toBeDefined();
      await verdictTool!.execute?.("tool-call-promotion-judge", {
        candidateId: embeddedParams.__candidateId ?? "candidate-missing",
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
      });

      const blockedWriteTool = tools.find((tool) => tool.name === "write");
      expect(blockedWriteTool).toBeDefined();
      await expect(
        blockedWriteTool!.execute?.("tool-call-blocked-write", {
          file_path: path.join(params.workspaceDir, "blocked.txt"),
          content: "should-not-run",
        }),
      ).rejects.toThrow('Tool "write" is not allowed for this special-agent run');

      return {
        payloads: [{ text: "submitted promotion verdict" }],
        meta: {
          durationMs: 10,
          agentMeta: {
            sessionId: embeddedParams.sessionId,
            provider: embeddedParams.provider ?? "openai",
            model: embeddedParams.model ?? "gpt-5.4",
            usage: { input: 50, output: 20, total: 70 },
          },
        },
      };
    },
  );

  return async function judge(candidateIdWorkspacePair: {
    workspaceDir: string;
    candidate: Parameters<typeof runPromotionJudge>[0]["candidate"];
  }) {
    return await runPromotionJudge(
      {
        workspaceDir: candidateIdWorkspacePair.workspaceDir,
        candidate: candidateIdWorkspacePair.candidate,
        embeddedContext: {
          sessionId: "session-promotion-judge-e2e",
          sessionFile: path.join(
            candidateIdWorkspacePair.workspaceDir,
            "promotion-judge.e2e.jsonl",
          ),
          workspaceDir: candidateIdWorkspacePair.workspaceDir,
          provider: "openai",
          model: "gpt-5.4",
          agentId: "main",
        },
      },
      {
        runSpecialAgentToCompletion: async (request) =>
          await runSpecialAgentToCompletion(request, {
            spawnAgentSessionDirect: vi.fn(),
            captureSubagentCompletionReply: vi.fn(),
            callGateway: vi.fn(),
            onAgentEvent: vi.fn(),
            runEmbeddedPiAgent: async (embeddedParams) =>
              await runEmbeddedPiAgent({
                ...embeddedParams,
                __candidateId: candidateIdWorkspacePair.candidate.id,
              }),
          }),
      },
    );
  };
}

describe("improvement workflow e2e", () => {
  it("runs through promotion judge embedded_fork and applies the promoted skill", async () => {
    await withStateDirEnv("crawclaw-improvement-e2e-", async () => {
      const workspaceDir = await tempDirs.make("improvement-workflow-e2e-");
      const embeddedJudge = createEmbeddedPromotionJudgeHarness({ workspaceDir });

      const result = await runImprovementWorkflow(
        {
          workspaceDir,
          judge: async ({ candidate }) =>
            await embeddedJudge({
              workspaceDir,
              candidate,
            }),
        },
        buildWorkflowDeps(),
      );

      expect(result.proposal?.status).toBe("pending_review");
      await reviewImprovementProposal({
        workspaceDir,
        proposalId: result.proposal!.id,
        approved: true,
        reviewer: "e2e",
      });

      const applied = await applyImprovementProposal({
        workspaceDir,
        proposalId: result.proposal!.id,
      });

      expect(applied.status).toBe("applied");
      expect(applied.patchPlan.kind).toBe("skill");
      const skillName = applied.patchPlan.kind === "skill" ? applied.patchPlan.skillName : "";
      await expect(
        fs.readFile(path.join(workspaceDir, ".agents", "skills", skillName, "SKILL.md"), "utf8"),
      ).resolves.toContain(`name: ${skillName}`);
    });
  });
});
