import { Type } from "@sinclair/typebox";
import { normalizePromotionVerdict } from "../../improvement/promotion-judge.js";
import { persistPromotionJudgeVerdictEnvelope } from "../../improvement/store.js";
import { stringEnum } from "../schema/typebox.js";
import { jsonResult, type AnyAgentTool } from "./common.js";

const PromotionVerdictToolSchema = Type.Object({
  candidateId: Type.String({
    description: "Improvement candidate id under review.",
  }),
  decision: stringEnum(
    [
      "keep_experience",
      "propose_skill",
      "propose_workflow",
      "propose_code",
      "needs_more_evidence",
      "reject",
    ] as const,
    {
      description: "Promotion decision for the candidate.",
    },
  ),
  confidence: stringEnum(["low", "medium", "high"] as const, {
    description: "Confidence in the decision.",
  }),
  riskLevel: stringEnum(["low", "medium", "high"] as const, {
    description: "Risk level for applying the promotion.",
  }),
  targetScope: Type.Optional(
    stringEnum(["workspace", "repo", "agent"] as const, {
      description: "Where the promoted artifact should live.",
    }),
  ),
  triggerPattern: Type.Optional(
    Type.String({
      description: "Trigger pattern for the promotion candidate.",
    }),
  ),
  reusableMethod: Type.Optional(
    Type.String({
      description: "Reusable method captured by the promotion.",
    }),
  ),
  reasonsFor: Type.Array(Type.String(), {
    description: "Reasons supporting the decision.",
  }),
  reasonsAgainst: Type.Array(Type.String(), {
    description: "Reasons against promotion.",
  }),
  missingEvidence: Type.Array(Type.String(), {
    description: "Evidence gaps that remain.",
  }),
  verificationPlan: Type.Array(Type.String(), {
    description: "Verification plan for the promoted artifact.",
  }),
});

type SubmitPromotionVerdictToolOptions = {
  workspaceDir?: string;
};

export function createSubmitPromotionVerdictTool(
  options: SubmitPromotionVerdictToolOptions,
): AnyAgentTool | null {
  const workspaceDir = options.workspaceDir?.trim();
  if (!workspaceDir) {
    return null;
  }
  return {
    label: "Submit Promotion Verdict",
    name: "submit_promotion_verdict",
    description:
      "Submit the structured verdict for the current promotion-judge run. Use exactly once per candidate.",
    parameters: PromotionVerdictToolSchema,
    execute: async (toolCallId, args) => {
      const verdict = normalizePromotionVerdict(args);
      await persistPromotionJudgeVerdictEnvelope({
        workspaceDir,
        runId: toolCallId,
        verdict,
      });
      return jsonResult({
        status: "ok",
        candidateId: verdict.candidateId,
        decision: verdict.decision,
      });
    },
  };
}
