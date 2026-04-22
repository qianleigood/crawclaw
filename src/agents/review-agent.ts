import { createRuntimeDenyToolPolicy } from "./special/runtime/definition-presets.js";
import type { SpecialAgentDefinition } from "./special/runtime/types.js";
import {
  aggregateReviewVerdict,
  parseReviewStageReport,
  type ReviewAggregateResult,
  type ReviewStage,
  type ReviewStageReport,
  type ReviewStageVerdict,
  type ReviewVerdict,
} from "./tasks/review-report.js";

export {
  aggregateReviewVerdict,
  parseReviewStageReport,
  type ReviewAggregateResult,
  type ReviewStage,
  type ReviewStageReport,
  type ReviewStageVerdict,
  type ReviewVerdict,
};

export const REVIEW_SPEC_SPAWN_SOURCE = "review-spec";
export const REVIEW_QUALITY_SPAWN_SOURCE = "review-quality";
export const REVIEW_SPAWN_SOURCES = [
  REVIEW_SPEC_SPAWN_SOURCE,
  REVIEW_QUALITY_SPAWN_SOURCE,
] as const;

export const REVIEW_TOOL_ALLOWLIST = [
  "read",
  "exec",
  "process",
  "code_execution",
  "web_search",
  "web_fetch",
  "image",
  "pdf",
  "session_status",
  "sessions_list",
  "sessions_history",
] as const;

export const REVIEW_SPEC_AGENT_DEFINITION: SpecialAgentDefinition = {
  id: "review-spec",
  label: "review spec",
  spawnSource: REVIEW_SPEC_SPAWN_SOURCE,
  executionMode: "spawned_session",
  transcriptPolicy: "isolated",
  toolPolicy: createRuntimeDenyToolPolicy(REVIEW_TOOL_ALLOWLIST),
  mode: "run",
  cleanup: "keep",
  sandbox: "inherit",
  expectsCompletionMessage: false,
  defaultRunTimeoutSeconds: 300,
};

export const REVIEW_QUALITY_AGENT_DEFINITION: SpecialAgentDefinition = {
  id: "review-quality",
  label: "review quality",
  spawnSource: REVIEW_QUALITY_SPAWN_SOURCE,
  executionMode: "spawned_session",
  transcriptPolicy: "isolated",
  toolPolicy: createRuntimeDenyToolPolicy(REVIEW_TOOL_ALLOWLIST),
  mode: "run",
  cleanup: "keep",
  sandbox: "inherit",
  expectsCompletionMessage: false,
  defaultRunTimeoutSeconds: 300,
};

export function isReviewSpawnSource(spawnSource?: string | null): boolean {
  const normalized = spawnSource?.trim();
  return normalized === REVIEW_SPEC_SPAWN_SOURCE || normalized === REVIEW_QUALITY_SPAWN_SOURCE;
}

function formatStageLabel(stage: ReviewStage): string {
  return stage === "spec" ? "Spec Compliance Review" : "Code Quality Review";
}

export function buildReviewStageSystemPrompt(stage: ReviewStage): string {
  const mission =
    stage === "spec"
      ? [
          "- Decide whether the implementation satisfies the original user request.",
          "- Check for missed explicit scope, unrelated refactors, repo-boundary violations, and missing docs/tests/evidence.",
          "- Focus on what was requested and what must be true before the task can be considered complete.",
        ]
      : [
          "- Decide whether the implementation quality is shippable.",
          "- Check correctness, edge cases, type design, import boundaries, tests, security, config, concurrency, and runtime risk.",
          "- Focus on implementation quality after the spec stage has not failed.",
        ];
  return [
    `# ${formatStageLabel(stage)}`,
    "",
    "You are an independent review agent. The parent agent cannot approve its own work.",
    "",
    "## Mission",
    ...mission,
    "",
    "## Constraints",
    "- Do NOT modify project files.",
    "- Do NOT use file-writing tools, patch tools, or code-editing tools.",
    "- Do NOT spawn additional agents.",
    "- Do NOT start nested review runs.",
    "- You may create disposable scripts under /tmp only if absolutely necessary for review evidence.",
    "",
    "## Output",
    "Return only a compact review report in this exact shape:",
    `STAGE: ${stage === "spec" ? "SPEC" : "QUALITY"}`,
    "VERDICT: PASS | FAIL | PARTIAL",
    "SUMMARY: one-line conclusion",
    "BLOCKING_ISSUES:",
    "- issue that must be fixed before the stage can pass",
    "- none",
    "WARNINGS:",
    "- residual risk, missing optional coverage, flaky precondition, or manual gap",
    "- none",
    "EVIDENCE:",
    "- command, file read, targeted inspection, or artifact used as evidence",
    "- none",
    "RECOMMENDED_FIXES:",
    "- concrete next fix",
    "- none",
    "",
    "Always include every section exactly once.",
    "If a section has nothing to report, write '- none'.",
    "A PASS verdict means no blocking issues remain for this stage.",
    "A FAIL verdict means blocking issues contradict or break this stage.",
    "A PARTIAL verdict means important evidence is missing or confidence is insufficient.",
  ].join("\n");
}

export function buildReviewStageTaskPrompt(params: {
  stage: ReviewStage;
  task: string;
  changedFiles?: string[];
  approach?: string;
  reviewFocus?: string[];
  planPath?: string;
  specReport?: ReviewStageReport;
}): string {
  const changedFiles = (params.changedFiles ?? []).map((entry) => entry.trim()).filter(Boolean);
  const reviewFocus = (params.reviewFocus ?? []).map((entry) => entry.trim()).filter(Boolean);
  return [
    `Run the ${formatStageLabel(params.stage)} stage for the implementation below.`,
    "",
    "## Original Task",
    params.task.trim(),
    ...(params.approach?.trim() ? ["", "## Reported Approach", params.approach.trim()] : []),
    ...(changedFiles.length > 0
      ? ["", "## Changed Files", ...changedFiles.map((entry) => `- ${entry}`)]
      : []),
    ...(reviewFocus.length > 0
      ? ["", "## Review Focus", ...reviewFocus.map((entry) => `- ${entry}`)]
      : []),
    ...(params.planPath?.trim() ? ["", "## Plan / Spec Path", params.planPath.trim()] : []),
    ...(params.specReport
      ? [
          "",
          "## Spec Compliance Review Result",
          `VERDICT: ${params.specReport.verdict}`,
          `SUMMARY: ${params.specReport.summary}`,
          ...(params.specReport.blockingIssues.length > 0
            ? ["BLOCKING_ISSUES:", ...params.specReport.blockingIssues.map((entry) => `- ${entry}`)]
            : []),
          ...(params.specReport.warnings.length > 0
            ? ["WARNINGS:", ...params.specReport.warnings.map((entry) => `- ${entry}`)]
            : []),
        ]
      : []),
    "",
    "Use the repository state as your source of truth.",
    "Prefer targeted checks over broad restatement.",
    "Return only the structured review report.",
  ].join("\n");
}
