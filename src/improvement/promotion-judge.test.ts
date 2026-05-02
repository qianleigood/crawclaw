import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { parsePromotionJudgeReplyVerdict, runPromotionJudge } from "./promotion-judge.js";
import { persistPromotionJudgeVerdictEnvelope, resolvePromotionJudgeVerdictPath } from "./store.js";
import type { PromotionCandidate, PromotionVerdict } from "./types.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

function makeCandidate(): PromotionCandidate {
  return {
    id: "candidate-judge-1",
    sourceRefs: [{ kind: "experience", ref: "experience-outbox:workflow-order" }],
    signalSummary: "Workflow 排查总是先查 registry，再查 operations。",
    observedFrequency: 2,
    currentReuseLevel: "experience",
    triggerPattern: "workflow 执行异常",
    repeatedActions: ["先查 registry，再查 operations。"],
    validationEvidence: ["两次修复都复用了这条路径。"],
    firstSeenAt: 1,
    lastSeenAt: 2,
  };
}

function makeVerdict(decision: PromotionVerdict["decision"]): PromotionVerdict {
  return {
    candidateId: "candidate-judge-1",
    decision,
    confidence: "high",
    riskLevel: decision === "propose_code" ? "high" : "low",
    targetScope: "workspace",
    triggerPattern: "workflow 执行异常",
    reusableMethod: "先查 registry，再查 operations。",
    reasonsFor: ["重复出现"],
    reasonsAgainst: [],
    missingEvidence: [],
    verificationPlan: ["验证提案结构"],
  };
}

describe("runPromotionJudge", () => {
  it("parses JSON fallback verdict replies", () => {
    const verdict = parsePromotionJudgeReplyVerdict(
      `{"verdict":"propose_workflow","candidate_id":"candidate-judge-1","reason":"稳定的排查流程。","summary":"先查 registry，再查 operations。"}`,
      makeCandidate(),
    );

    expect(verdict).toEqual(
      expect.objectContaining({
        candidateId: "candidate-judge-1",
        decision: "propose_workflow",
        confidence: "medium",
        riskLevel: "medium",
        triggerPattern: "workflow 执行异常",
        reusableMethod: "先查 registry，再查 operations。",
        reasonsFor: ["稳定的排查流程。"],
      }),
    );
  });

  it("parses legacy fallback verdict replies", () => {
    const verdict = parsePromotionJudgeReplyVerdict(
      "submit_promotion_verdict: candidate-judge-1, keep_experience, 频次还不够高，先保留为经验。",
      makeCandidate(),
    );

    expect(verdict).toEqual(
      expect.objectContaining({
        candidateId: "candidate-judge-1",
        decision: "keep_experience",
        confidence: "medium",
        riskLevel: "low",
        reasonsFor: ["频次还不够高，先保留为经验。"],
      }),
    );
  });

  it("rejects completion without a structured verdict submission", async () => {
    const workspaceDir = await tempDirs.make("promotion-judge-");

    await expect(
      runPromotionJudge(
        {
          workspaceDir,
          candidate: makeCandidate(),
          embeddedContext: {
            sessionId: "session-parent",
            sessionFile: path.join(workspaceDir, "session.jsonl"),
            workspaceDir,
          },
        },
        {
          runSpecialAgentToCompletion: async () => ({
            status: "completed",
            runId: "run-missing-verdict",
            childSessionKey: "embedded:promotion-judge:run-missing-verdict",
            reply: "plain text only",
          }),
        },
      ),
    ).rejects.toThrow("structured verdict");

    expect(
      resolvePromotionJudgeVerdictPath({
        workspaceDir,
        candidateId: makeCandidate().id,
      }),
    ).toContain(".crawclaw");
  });

  it.each(["propose_skill", "propose_workflow", "propose_code"] as const)(
    "accepts submitted %s verdicts",
    async (decision) => {
      const workspaceDir = await tempDirs.make(`promotion-judge-${decision}-`);
      const verdict = makeVerdict(decision);

      const resolved = await runPromotionJudge(
        {
          workspaceDir,
          candidate: makeCandidate(),
          embeddedContext: {
            sessionId: "session-parent",
            sessionFile: path.join(workspaceDir, "session.jsonl"),
            workspaceDir,
          },
        },
        {
          runSpecialAgentToCompletion: async () => {
            await persistPromotionJudgeVerdictEnvelope({
              workspaceDir,
              runId: "run-submitted-verdict",
              verdict,
            });
            return {
              status: "completed",
              runId: "run-submitted-verdict",
              childSessionKey: "embedded:promotion-judge:run-submitted-verdict",
              reply: "done",
            };
          },
        },
      );

      expect(resolved).toEqual(verdict);
    },
  );

  it("accepts parsable fallback replies when the model does not emit a tool call", async () => {
    const workspaceDir = await tempDirs.make("promotion-judge-fallback-");

    const resolved = await runPromotionJudge(
      {
        workspaceDir,
        candidate: makeCandidate(),
        embeddedContext: {
          sessionId: "session-parent",
          sessionFile: path.join(workspaceDir, "session.jsonl"),
          workspaceDir,
        },
      },
      {
        runSpecialAgentToCompletion: async () => ({
          status: "completed",
          runId: "run-fallback-verdict",
          childSessionKey: "embedded:promotion-judge:run-fallback-verdict",
          reply:
            '{"verdict":"propose_workflow","candidate_id":"candidate-judge-1","reason":"步骤稳定，可沉淀为 workflow。"}',
        }),
      },
    );

    expect(resolved).toEqual(
      expect.objectContaining({
        candidateId: "candidate-judge-1",
        decision: "propose_workflow",
        riskLevel: "medium",
      }),
    );
  });
});
