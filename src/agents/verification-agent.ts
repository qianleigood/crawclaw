import type { SpecialAgentDefinition } from "./special/runtime/types.js";

export const VERIFICATION_SPAWN_SOURCE = "verification";
export const VERIFICATION_TOOL_ALLOWLIST = [
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
export const VERIFICATION_AGENT_DEFINITION: SpecialAgentDefinition = {
  id: "verification",
  label: "verification",
  spawnSource: VERIFICATION_SPAWN_SOURCE,
  executionMode: "spawned_session",
  transcriptPolicy: "isolated",
  toolPolicy: {
    allowlist: VERIFICATION_TOOL_ALLOWLIST,
    enforcement: "runtime_deny",
  },
  mode: "run",
  cleanup: "keep",
  sandbox: "inherit",
  expectsCompletionMessage: false,
  defaultRunTimeoutSeconds: 300,
};

export type VerificationVerdict = "PASS" | "FAIL" | "PARTIAL";
export type VerificationCheckStatus = "PASS" | "FAIL" | "WARN";
export type VerificationCheck = {
  status: VerificationCheckStatus;
  summary: string;
};
export type VerificationReport = {
  verdict?: VerificationVerdict;
  summary?: string;
  checks: VerificationCheck[];
  failingCommands: string[];
  warnings: string[];
  artifacts: string[];
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildVerificationSystemPrompt(): string {
  return [
    "# Verification Agent",
    "",
    "You are a dedicated verification agent. Your job is to challenge the implementation and find gaps before the parent agent declares success.",
    "",
    "## Mission",
    "- Try to disprove that the task is complete.",
    "- Reproduce the claimed fix or behavior.",
    "- Prefer concrete evidence: commands, reads, targeted searches, and narrow inspections.",
    "",
    "## Constraints",
    "- Do NOT modify project files.",
    "- Do NOT use file-writing tools, patch tools, or code-editing tools.",
    "- Do NOT spawn additional agents.",
    "- You may create disposable scripts under /tmp only if absolutely necessary for verification.",
    "",
    "## Output",
    "Return a compact verification report in this exact shape:",
    "VERDICT: PASS | FAIL | PARTIAL",
    "SUMMARY: one-line conclusion",
    "CHECKS:",
    "- PASS: ...",
    "- FAIL: ...",
    "- WARN: ...",
    "FAILING_COMMANDS:",
    "- command :: why it failed",
    "- none",
    "WARNINGS:",
    "- missing coverage, manual gap, flaky precondition, or residual risk",
    "- none",
    "ARTIFACTS:",
    "- path/to/log.txt",
    "- screenshot.png",
    "- none",
    "",
    "Always include every section exactly once.",
    "If a section has nothing to report, write '- none'.",
    "Keep each bullet concrete and evidence-oriented.",
    "A PASS verdict means you found enough concrete evidence to support completion.",
    "A FAIL verdict means the implementation is broken, missing, or contradicted by your checks.",
    "A PARTIAL verdict means you found some evidence, but important verification remains missing.",
  ].join("\n");
}

export function buildVerificationTaskPrompt(params: {
  task: string;
  changedFiles?: string[];
  approach?: string;
  validationFocus?: string[];
  planPath?: string;
}): string {
  const changedFiles = (params.changedFiles ?? []).map((entry) => entry.trim()).filter(Boolean);
  const validationFocus = (params.validationFocus ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);

  return [
    "Verify the implementation below and return a strict verification report.",
    "",
    "## Original Task",
    params.task.trim(),
    ...(params.approach?.trim() ? ["", "## Reported Approach", params.approach.trim()] : []),
    ...(changedFiles.length > 0
      ? ["", "## Changed Files", ...changedFiles.map((entry) => `- ${entry}`)]
      : []),
    ...(validationFocus.length > 0
      ? ["", "## Verification Focus", ...validationFocus.map((entry) => `- ${entry}`)]
      : []),
    ...(params.planPath?.trim() ? ["", "## Plan / Spec Path", params.planPath.trim()] : []),
    "",
    "Use the repository state as your source of truth. Prefer targeted checks over broad restatement.",
    "List the most important checks, any failing commands you ran, notable warnings, and concrete artifacts.",
  ].join("\n");
}

function normalizeSectionName(
  value: string,
): keyof Pick<VerificationReport, "checks" | "failingCommands" | "warnings" | "artifacts"> | null {
  switch (value.trim().toUpperCase()) {
    case "CHECKS":
      return "checks";
    case "FAILING_COMMANDS":
    case "FAILING COMMANDS":
      return "failingCommands";
    case "WARNINGS":
      return "warnings";
    case "ARTIFACTS":
      return "artifacts";
    default:
      return null;
  }
}

function isNoneBullet(value: string): boolean {
  return /^(none|n\/a|na)$/i.test(value.trim());
}

function parseVerificationCheck(value: string): VerificationCheck {
  const normalized = value.trim();
  const match = normalized.match(/^(PASS|FAIL|WARN|WARNING)\s*:\s*(.+)$/i);
  if (!match) {
    return {
      status: "WARN",
      summary: normalized,
    };
  }
  return {
    status:
      match[1].toUpperCase() === "WARNING"
        ? "WARN"
        : (match[1].toUpperCase() as VerificationCheckStatus),
    summary: match[2].trim(),
  };
}

export function parseVerificationReport(text: string): VerificationReport {
  const normalized = normalizeOptionalString(text);
  if (!normalized) {
    return {
      checks: [],
      failingCommands: [],
      warnings: [],
      artifacts: [],
    };
  }
  const verdictMatch = normalized.match(/^\s*VERDICT:\s*(PASS|FAIL|PARTIAL)\s*$/im);
  const summaryMatch = normalized.match(/^\s*SUMMARY:\s*(.+)\s*$/im);
  const checks: VerificationCheck[] = [];
  const failingCommands: string[] = [];
  const warnings: string[] = [];
  const artifacts: string[] = [];
  let currentSection:
    | keyof Pick<VerificationReport, "checks" | "failingCommands" | "warnings" | "artifacts">
    | null = null;
  const lines = normalized.split(/\r?\n/);
  for (const line of lines) {
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
    if (currentSection === "checks") {
      checks.push(parseVerificationCheck(bullet));
      continue;
    }
    if (currentSection === "failingCommands") {
      failingCommands.push(bullet);
      continue;
    }
    if (currentSection === "warnings") {
      warnings.push(bullet);
      continue;
    }
    artifacts.push(bullet);
  }
  return {
    checks,
    failingCommands,
    warnings,
    artifacts,
    ...(verdictMatch ? { verdict: verdictMatch[1] as VerificationVerdict } : {}),
    ...(summaryMatch ? { summary: summaryMatch[1].trim() } : {}),
  };
}

export function parseVerificationVerdict(text: string): {
  verdict?: VerificationVerdict;
  summary?: string;
} {
  const report = parseVerificationReport(text);
  return {
    ...(report.verdict ? { verdict: report.verdict } : {}),
    ...(report.summary ? { summary: report.summary } : {}),
  };
}
