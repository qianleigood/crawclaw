import { createEmbeddedMemorySpecialAgentDefinition } from "../agents/special/runtime/definition-presets.js";
import { runSpecialAgentToCompletion } from "../agents/special/runtime/run-once.js";
import type {
  SpecialAgentCompletionResult,
  SpecialAgentDefinition,
  SpecialAgentEmbeddedContext,
  SpecialAgentSpawnRequest,
} from "../agents/special/runtime/types.js";
import {
  deletePromotionJudgeVerdictEnvelope,
  loadPromotionJudgeVerdictEnvelope,
  persistPromotionJudgeVerdictEnvelope,
} from "./store.js";
import type { PromotionCandidate, PromotionVerdict } from "./types.js";

export const PROMOTION_JUDGE_SPAWN_SOURCE = "promotion-judge";
export const PROMOTION_JUDGE_TOOL_ALLOWLIST = ["read", "submit_promotion_verdict"] as const;
export const PROMOTION_JUDGE_AGENT_DEFINITION: SpecialAgentDefinition =
  createEmbeddedMemorySpecialAgentDefinition({
    id: "promotion-judge",
    label: "promotion-judge",
    spawnSource: PROMOTION_JUDGE_SPAWN_SOURCE,
    allowlist: PROMOTION_JUDGE_TOOL_ALLOWLIST,
    parentContextPolicy: "none",
    modelVisibility: "allowlist",
    defaultRunTimeoutSeconds: 90,
    defaultMaxTurns: 4,
  });

function readOptionalString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

function readRequiredString(value: unknown, label: string): string {
  const trimmed = readOptionalString(value);
  if (!trimmed) {
    throw new Error(`${label} required`);
  }
  return trimmed;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizePromotionVerdict(input: unknown): PromotionVerdict {
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const decision = readRequiredString(record.decision, "decision");
  const confidence = readRequiredString(record.confidence, "confidence");
  const riskLevel = readRequiredString(record.riskLevel, "riskLevel");
  const candidateId = readRequiredString(record.candidateId, "candidateId");

  if (
    decision !== "keep_experience" &&
    decision !== "propose_skill" &&
    decision !== "propose_workflow" &&
    decision !== "propose_code" &&
    decision !== "needs_more_evidence" &&
    decision !== "reject"
  ) {
    throw new Error("invalid decision");
  }
  if (confidence !== "low" && confidence !== "medium" && confidence !== "high") {
    throw new Error("invalid confidence");
  }
  if (riskLevel !== "low" && riskLevel !== "medium" && riskLevel !== "high") {
    throw new Error("invalid riskLevel");
  }
  const targetScope = readOptionalString(record.targetScope);
  if (
    targetScope &&
    targetScope !== "workspace" &&
    targetScope !== "repo" &&
    targetScope !== "agent"
  ) {
    throw new Error("invalid targetScope");
  }
  const normalizedTargetScope =
    targetScope === "workspace" || targetScope === "repo" || targetScope === "agent"
      ? targetScope
      : undefined;

  return {
    candidateId,
    decision,
    confidence,
    riskLevel,
    ...(normalizedTargetScope ? { targetScope: normalizedTargetScope } : {}),
    ...(readOptionalString(record.triggerPattern)
      ? { triggerPattern: readOptionalString(record.triggerPattern) }
      : {}),
    ...(readOptionalString(record.reusableMethod)
      ? { reusableMethod: readOptionalString(record.reusableMethod) }
      : {}),
    reasonsFor: readStringArray(record.reasonsFor),
    reasonsAgainst: readStringArray(record.reasonsAgainst),
    missingEvidence: readStringArray(record.missingEvidence),
    verificationPlan: readStringArray(record.verificationPlan),
  };
}

function extractFallbackJsonObject(reply: string): Record<string, unknown> | null {
  const candidates = [
    reply,
    ...Array.from(reply.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)).map((match) => match[1] ?? ""),
  ];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function readOptionalVerdictField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeFallbackStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }
  const single = readOptionalVerdictField(value);
  return single ? [single] : undefined;
}

function defaultRiskLevelForDecision(
  decision: PromotionVerdict["decision"],
): PromotionVerdict["riskLevel"] {
  if (decision === "propose_workflow") {
    return "medium";
  }
  if (decision === "propose_code") {
    return "high";
  }
  return "low";
}

function defaultVerificationPlanForDecision(
  decision: PromotionVerdict["decision"],
): PromotionVerdict["verificationPlan"] {
  if (decision === "propose_skill") {
    return ["Verify skill frontmatter", "Verify workspace skill discovery"];
  }
  if (decision === "propose_workflow") {
    return ["Verify workflow draft", "Verify workflow policy flags"];
  }
  if (decision === "propose_code") {
    return ["Review proposal completeness"];
  }
  return [];
}

function buildFallbackPromotionVerdict(params: {
  candidate: PromotionCandidate;
  decision: PromotionVerdict["decision"];
  payload?: Record<string, unknown>;
  reason?: string;
}): PromotionVerdict {
  const confidence = readOptionalVerdictField(params.payload?.confidence);
  const riskLevel = readOptionalVerdictField(params.payload?.riskLevel);
  const targetScope = readOptionalVerdictField(params.payload?.targetScope);
  const reusableMethod =
    readOptionalVerdictField(params.payload?.reusableMethod) ??
    readOptionalVerdictField(params.payload?.summary);
  const reason =
    params.reason ??
    readOptionalVerdictField(params.payload?.reason) ??
    readOptionalVerdictField(params.payload?.reasoning);
  const reasonsFor =
    normalizeFallbackStringArray(params.payload?.reasonsFor) ??
    (reason && params.decision !== "reject" && params.decision !== "needs_more_evidence"
      ? [reason]
      : []);
  const reasonsAgainst =
    normalizeFallbackStringArray(params.payload?.reasonsAgainst) ??
    (reason && params.decision === "reject" ? [reason] : []);
  const missingEvidence =
    normalizeFallbackStringArray(params.payload?.missingEvidence) ??
    (reason && params.decision === "needs_more_evidence" ? [reason] : []);
  const verificationPlan =
    normalizeFallbackStringArray(params.payload?.verificationPlan) ??
    defaultVerificationPlanForDecision(params.decision);
  return {
    candidateId: params.candidate.id,
    decision: params.decision,
    confidence:
      confidence === "low" || confidence === "medium" || confidence === "high"
        ? confidence
        : "medium",
    riskLevel:
      riskLevel === "low" || riskLevel === "medium" || riskLevel === "high"
        ? riskLevel
        : defaultRiskLevelForDecision(params.decision),
    ...(targetScope === "workspace" || targetScope === "repo" || targetScope === "agent"
      ? { targetScope }
      : {}),
    ...(params.candidate.triggerPattern ? { triggerPattern: params.candidate.triggerPattern } : {}),
    ...(reusableMethod ? { reusableMethod } : {}),
    reasonsFor,
    reasonsAgainst,
    missingEvidence,
    verificationPlan,
  };
}

export function parsePromotionJudgeReplyVerdict(
  reply: string,
  candidate: PromotionCandidate,
): PromotionVerdict | null {
  const payload = extractFallbackJsonObject(reply);
  if (payload) {
    const candidateId =
      readOptionalVerdictField(payload.candidateId) ??
      readOptionalVerdictField(payload.candidate_id);
    if (candidateId && candidateId !== candidate.id) {
      return null;
    }
    const decision =
      readOptionalVerdictField(payload.decision) ?? readOptionalVerdictField(payload.verdict);
    if (
      decision === "keep_experience" ||
      decision === "propose_skill" ||
      decision === "propose_workflow" ||
      decision === "propose_code" ||
      decision === "needs_more_evidence" ||
      decision === "reject"
    ) {
      return buildFallbackPromotionVerdict({
        candidate,
        decision,
        payload,
      });
    }
  }

  const legacyMatch = reply.match(
    /submit_promotion_verdict:\s*([^,]+)\s*,\s*(keep_experience|propose_skill|propose_workflow|propose_code|needs_more_evidence|reject)\s*,\s*([\s\S]+)/i,
  );
  if (!legacyMatch) {
    return null;
  }
  const candidateId = legacyMatch[1]?.trim();
  const decision = legacyMatch[2]?.trim() as PromotionVerdict["decision"] | undefined;
  const reason = legacyMatch[3]?.trim();
  if (!candidateId || candidateId !== candidate.id || !decision) {
    return null;
  }
  return buildFallbackPromotionVerdict({
    candidate,
    decision,
    reason,
  });
}

export function buildPromotionJudgeSystemPrompt(): string {
  return [
    "# Promotion Judge",
    "",
    "You are a narrow review agent for CrawClaw self-improvement.",
    "",
    "Decide whether the supplied candidate should stay as experience or be promoted.",
    "You must submit exactly one structured verdict with submit_promotion_verdict.",
    "",
    "Constraints:",
    "- You may read relevant project files with read when the candidate mentions files, modules, workflows, skills, tools, prompts, or code-owned behavior.",
    "- Only inspect files needed to validate the candidate against current code.",
    "- Do not write, edit, patch, or run shell commands.",
    "- Do not describe the verdict in free-form text instead of the tool.",
    "- Base the verdict on the supplied candidate evidence and read-only code evidence when available.",
    "",
    "Decision options:",
    "- keep_experience",
    "- propose_skill",
    "- propose_workflow",
    "- propose_code",
    "- needs_more_evidence",
    "- reject",
  ].join("\n");
}

export function buildPromotionJudgeTaskPrompt(candidate: PromotionCandidate): string {
  return [
    "Review this promotion candidate and decide whether it should be promoted.",
    "",
    `Candidate ID: ${candidate.id}`,
    `Signal summary: ${candidate.signalSummary}`,
    `Observed frequency: ${candidate.observedFrequency}`,
    `Current reuse level: ${candidate.currentReuseLevel}`,
    ...(candidate.triggerPattern ? [`Trigger pattern: ${candidate.triggerPattern}`] : []),
    "",
    "Source refs:",
    ...(candidate.sourceRefs.length > 0
      ? candidate.sourceRefs.map((sourceRef) => `- ${sourceRef.kind}: ${sourceRef.ref}`)
      : ["- (none)"]),
    "",
    "Repeated actions:",
    ...(candidate.repeatedActions.length > 0
      ? candidate.repeatedActions.map((action) => `- ${action}`)
      : ["- (none)"]),
    "",
    "Validation evidence:",
    ...(candidate.validationEvidence.length > 0
      ? candidate.validationEvidence.map((evidence) => `- ${evidence}`)
      : ["- (none)"]),
    "",
    "When the candidate refers to code, workflows, skills, tools, prompts, or repository behavior, read the relevant project files before submitting the verdict.",
    "",
    "Submit exactly one verdict with submit_promotion_verdict, then stop.",
  ].join("\n");
}

export type PromotionJudgeRunParams = {
  workspaceDir: string;
  candidate: PromotionCandidate;
  embeddedContext: Pick<SpecialAgentEmbeddedContext, "sessionId" | "sessionFile" | "workspaceDir"> &
    Partial<SpecialAgentEmbeddedContext>;
  parentForkContext?: SpecialAgentSpawnRequest["parentForkContext"];
  spawnContext?: SpecialAgentSpawnRequest["spawnContext"];
};

export type PromotionJudgeDeps = {
  runSpecialAgentToCompletion: (
    request: SpecialAgentSpawnRequest,
  ) => Promise<SpecialAgentCompletionResult>;
};

const defaultPromotionJudgeDeps: PromotionJudgeDeps = {
  runSpecialAgentToCompletion,
};

export async function runPromotionJudge(
  params: PromotionJudgeRunParams,
  deps: PromotionJudgeDeps = defaultPromotionJudgeDeps,
): Promise<PromotionVerdict> {
  await deletePromotionJudgeVerdictEnvelope({
    workspaceDir: params.workspaceDir,
    candidateId: params.candidate.id,
  });

  const completion = await deps.runSpecialAgentToCompletion({
    definition: PROMOTION_JUDGE_AGENT_DEFINITION,
    task: buildPromotionJudgeTaskPrompt(params.candidate),
    extraSystemPrompt: buildPromotionJudgeSystemPrompt(),
    embeddedContext: {
      ...params.embeddedContext,
      workspaceDir: params.workspaceDir,
    },
    parentForkContext: params.parentForkContext,
    spawnContext: params.spawnContext,
  });

  if (completion.status !== "completed") {
    throw new Error(completion.error);
  }

  const envelope = await loadPromotionJudgeVerdictEnvelope({
    workspaceDir: params.workspaceDir,
    candidateId: params.candidate.id,
  });
  if (!envelope) {
    const fallbackVerdict = parsePromotionJudgeReplyVerdict(completion.reply, params.candidate);
    if (!fallbackVerdict) {
      throw new Error("Promotion judge must submit a structured verdict before completing.");
    }
    await persistPromotionJudgeVerdictEnvelope({
      workspaceDir: params.workspaceDir,
      runId: completion.runId,
      verdict: fallbackVerdict,
    });
    return fallbackVerdict;
  }
  const verdict = normalizePromotionVerdict(envelope.verdict);
  if (verdict.candidateId !== params.candidate.id) {
    throw new Error("Promotion judge verdict candidateId mismatch.");
  }
  return verdict;
}
