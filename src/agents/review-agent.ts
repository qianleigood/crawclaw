import { createRuntimeDenyToolPolicy } from "./special/runtime/definition-presets.js";
import type { SpecialAgentDefinition } from "./special/runtime/types.js";

export const REVIEW_SPEC_SPAWN_SOURCE = "review-spec";
export const REVIEW_QUALITY_SPAWN_SOURCE = "review-quality";
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

export type ReviewStage = "spec" | "quality";
export type ReviewVerdict = "PASS" | "FAIL" | "PARTIAL";
export type ReviewPipelineVerdict = "REVIEW_PASS" | "REVIEW_FAIL" | "REVIEW_PARTIAL";

export type ReviewStageReport = {
  stage: ReviewStage;
  verdict: ReviewVerdict;
  summary: string;
  blockingIssues: string[];
  warnings: string[];
  evidence: string[];
  recommendedFixes: string[];
};

export type ReviewPipelineReport = {
  verdict: ReviewPipelineVerdict;
  summary: string;
  spec: ReviewStageReport;
  quality?: ReviewStageReport;
  skippedStages: ReviewStage[];
  blockingIssues: string[];
  warnings: string[];
  evidence: string[];
  recommendedFixes: string[];
};

function formatStageLabel(stage: ReviewStage): string {
  return stage === "spec" ? "Spec Compliance Review" : "Code Quality Review";
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isNoneBullet(value: string): boolean {
  return /^(none|n\/a|na)$/i.test(value.trim());
}

function parseStage(value: string | undefined): ReviewStage | undefined {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "SPEC") {
    return "spec";
  }
  if (normalized === "QUALITY") {
    return "quality";
  }
  return undefined;
}

function parseVerdict(value: string | undefined): ReviewVerdict | undefined {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "PASS" || normalized === "FAIL" || normalized === "PARTIAL") {
    return normalized;
  }
  return undefined;
}

type ReviewSection = "blockingIssues" | "warnings" | "evidence" | "recommendedFixes";

function normalizeSectionName(value: string): ReviewSection | null {
  switch (value.trim().toUpperCase()) {
    case "BLOCKING_ISSUES":
    case "BLOCKING ISSUES":
      return "blockingIssues";
    case "WARNINGS":
      return "warnings";
    case "EVIDENCE":
      return "evidence";
    case "RECOMMENDED_FIXES":
    case "RECOMMENDED FIXES":
      return "recommendedFixes";
    default:
      return null;
  }
}

export function parseReviewStageReport(
  text: string,
  options: { fallbackStage?: ReviewStage } = {},
): ReviewStageReport {
  const normalized = normalizeOptionalString(text) ?? "";
  const stageMatch = normalized.match(/^\s*STAGE:\s*(SPEC|QUALITY)\s*$/im);
  const verdictMatch = normalized.match(/^\s*VERDICT:\s*(PASS|FAIL|PARTIAL)\s*$/im);
  const summaryMatch = normalized.match(/^\s*SUMMARY:\s*(.+)\s*$/im);
  const stage = parseStage(stageMatch?.[1]) ?? options.fallbackStage ?? "spec";
  const verdict = parseVerdict(verdictMatch?.[1]) ?? "PARTIAL";
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const evidence: string[] = [];
  const recommendedFixes: string[] = [];
  let currentSection: ReviewSection | null = null;

  for (const line of normalized.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*([A-Z][A-Z_ ]+):\s*$/);
    if (sectionMatch) {
      currentSection = normalizeSectionName(sectionMatch[1]);
      continue;
    }
    if (!currentSection) {
      continue;
    }
    const bulletMatch = line.match(/^\s*-\s+(.+?)\s*$/);
    if (!bulletMatch) {
      continue;
    }
    const bullet = bulletMatch[1].trim();
    if (!bullet || isNoneBullet(bullet)) {
      continue;
    }
    if (currentSection === "blockingIssues") {
      blockingIssues.push(bullet);
    } else if (currentSection === "warnings") {
      warnings.push(bullet);
    } else if (currentSection === "evidence") {
      evidence.push(bullet);
    } else {
      recommendedFixes.push(bullet);
    }
  }

  if (!stageMatch) {
    warnings.push("Review report did not include a valid STAGE line.");
  }
  if (!verdictMatch) {
    warnings.push("Review report did not include a valid VERDICT line.");
  }

  return {
    stage,
    verdict,
    summary:
      summaryMatch?.[1]?.trim() ??
      (verdictMatch
        ? "Review stage completed without a summary."
        : "Review report was incomplete."),
    blockingIssues,
    warnings,
    evidence,
    recommendedFixes,
  };
}

export function buildReviewStageSystemPrompt(stage: ReviewStage): string {
  const label = formatStageLabel(stage);
  const mission =
    stage === "spec"
      ? [
          "- Check whether the implementation satisfies the original user request and declared acceptance criteria.",
          "- Identify missing scope, incorrect scope, unsupported completion claims, and required docs/tests/evidence gaps.",
          "- Do not review style for its own sake; focus on whether the right thing was built.",
        ]
      : [
          "- Check correctness, maintainability, tests, boundaries, security, configuration, and runtime risks.",
          "- Challenge the implementation quality after the spec review has not failed.",
          "- Do not restate the spec review; focus on whether the implementation is safe to land.",
        ];
  return [
    `# ${label}`,
    "",
    "You are an independent review agent. Your job is to challenge the parent agent's work before it can be considered complete.",
    "",
    "## Mission",
    ...mission,
    "",
    "## Constraints",
    "- Do NOT modify project files.",
    "- Do NOT use file-writing tools, patch tools, or code-editing tools.",
    "- Do NOT spawn additional agents.",
    "- You may create disposable scripts under /tmp only if absolutely necessary for review.",
    "",
    "## Output",
    "Return a compact review report in this exact shape:",
    `STAGE: ${stage === "spec" ? "SPEC" : "QUALITY"}`,
    "VERDICT: PASS | FAIL | PARTIAL",
    "SUMMARY: one-line conclusion",
    "BLOCKING_ISSUES:",
    "- issue that must be fixed before the review can pass",
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
          "## Spec Review Result",
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
    "Use the repository state as your source of truth. Prefer targeted checks over broad restatement.",
    "Return only the structured review report.",
  ].join("\n");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}

export function aggregateReviewReports(params: {
  spec: ReviewStageReport;
  quality?: ReviewStageReport;
}): ReviewPipelineReport {
  const skippedStages: ReviewStage[] = [];
  if (params.spec.verdict === "FAIL") {
    skippedStages.push("quality");
  }
  const quality = params.spec.verdict === "FAIL" ? undefined : params.quality;
  const verdict: ReviewPipelineVerdict =
    params.spec.verdict === "FAIL" || quality?.verdict === "FAIL"
      ? "REVIEW_FAIL"
      : params.spec.verdict === "PARTIAL" || quality?.verdict === "PARTIAL" || !quality
        ? "REVIEW_PARTIAL"
        : "REVIEW_PASS";
  const stageSummaries = [params.spec.summary, quality?.summary].filter(Boolean).join(" ");

  return {
    verdict,
    summary: stageSummaries || "Review completed.",
    spec: params.spec,
    ...(quality ? { quality } : {}),
    skippedStages,
    blockingIssues: uniqueStrings([
      ...params.spec.blockingIssues,
      ...(quality?.blockingIssues ?? []),
    ]),
    warnings: uniqueStrings([...params.spec.warnings, ...(quality?.warnings ?? [])]),
    evidence: uniqueStrings([...params.spec.evidence, ...(quality?.evidence ?? [])]),
    recommendedFixes: uniqueStrings([
      ...params.spec.recommendedFixes,
      ...(quality?.recommendedFixes ?? []),
    ]),
  };
}
