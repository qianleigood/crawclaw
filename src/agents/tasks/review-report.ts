export type ReviewStage = "spec" | "quality";
export type ReviewStageVerdict = "PASS" | "FAIL" | "PARTIAL";
export type ReviewVerdict = "REVIEW_PASS" | "REVIEW_FAIL" | "REVIEW_PARTIAL";

export type ReviewStageReport = {
  stage: ReviewStage;
  verdict: ReviewStageVerdict;
  summary: string;
  blockingIssues: string[];
  warnings: string[];
  evidence: string[];
  recommendedFixes: string[];
  valid: boolean;
};

export type ReviewAggregateResult = {
  verdict: ReviewVerdict;
  summary: string;
  spec: ReviewStageReport;
  quality?: ReviewStageReport;
  skippedStages: ReviewStage[];
  blockingIssues: string[];
  warnings: string[];
  evidence: string[];
  recommendedFixes: string[];
};

type ReviewSection = "blockingIssues" | "warnings" | "evidence" | "recommendedFixes";

const REQUIRED_HEADERS = [
  "STAGE",
  "VERDICT",
  "SUMMARY",
  "BLOCKING_ISSUES",
  "WARNINGS",
  "EVIDENCE",
  "RECOMMENDED_FIXES",
] as const;

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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

function parseVerdict(value: string | undefined): ReviewStageVerdict | undefined {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "PASS" || normalized === "FAIL" || normalized === "PARTIAL") {
    return normalized;
  }
  return undefined;
}

function normalizeHeader(value: string): string {
  return value.trim().toUpperCase().replaceAll(" ", "_");
}

function normalizeSectionName(value: string): ReviewSection | null {
  switch (normalizeHeader(value)) {
    case "BLOCKING_ISSUES":
      return "blockingIssues";
    case "WARNINGS":
      return "warnings";
    case "EVIDENCE":
      return "evidence";
    case "RECOMMENDED_FIXES":
      return "recommendedFixes";
    default:
      return null;
  }
}

function isNoneBullet(value: string): boolean {
  return /^(none|n\/a|na)$/i.test(value.trim());
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}

export function parseReviewStageReport(
  text: string,
  expectedStage: ReviewStage,
): ReviewStageReport {
  const normalized = normalizeOptionalString(text) ?? "";
  const seenHeaders = new Set<string>();
  const stageMatch = normalized.match(/^\s*STAGE:\s*(SPEC|QUALITY)\s*$/im);
  const verdictMatch = normalized.match(/^\s*VERDICT:\s*(PASS|FAIL|PARTIAL)\s*$/im);
  const summaryMatch = normalized.match(/^\s*SUMMARY:\s*(.+)\s*$/im);
  const parsedStage = parseStage(stageMatch?.[1]);
  const stage = parsedStage ?? expectedStage;
  const parsedVerdict = parseVerdict(verdictMatch?.[1]);
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const evidence: string[] = [];
  const recommendedFixes: string[] = [];
  let currentSection: ReviewSection | null = null;

  for (const line of normalized.split(/\r?\n/)) {
    const inlineHeaderMatch = line.match(/^\s*([A-Z][A-Z_ ]+):(?:\s*(.*?))?\s*$/);
    if (inlineHeaderMatch) {
      const header = normalizeHeader(inlineHeaderMatch[1]);
      seenHeaders.add(header);
      currentSection = normalizeSectionName(inlineHeaderMatch[1]);
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

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !seenHeaders.has(header));
  const invalidReasons: string[] = [];
  if (missingHeaders.length > 0) {
    invalidReasons.push(`missing required header(s): ${missingHeaders.join(", ")}`);
  }
  if (!parsedStage) {
    invalidReasons.push("missing or invalid STAGE");
  } else if (parsedStage !== expectedStage) {
    invalidReasons.push(`expected ${expectedStage.toUpperCase()} stage`);
  }
  if (!parsedVerdict) {
    invalidReasons.push("missing or invalid VERDICT");
  }
  if (!summaryMatch?.[1]?.trim()) {
    invalidReasons.push("missing SUMMARY");
  }

  const valid = invalidReasons.length === 0;
  return {
    stage,
    verdict: valid ? parsedVerdict! : "PARTIAL",
    summary: summaryMatch?.[1]?.trim() ?? "Review report was invalid or incomplete.",
    blockingIssues,
    warnings: valid
      ? warnings
      : uniqueStrings([
          ...warnings,
          "Review report invalid or incomplete.",
          ...invalidReasons.map((reason) => `Invalid report: ${reason}.`),
        ]),
    evidence,
    recommendedFixes,
    valid,
  };
}

export function aggregateReviewVerdict(params: {
  spec: ReviewStageReport;
  quality?: ReviewStageReport;
}): ReviewAggregateResult {
  const skippedStages: ReviewStage[] = params.spec.verdict === "FAIL" ? ["quality"] : [];
  const quality = params.spec.verdict === "FAIL" ? undefined : params.quality;
  const baseVerdict: ReviewVerdict =
    params.spec.verdict === "FAIL" || quality?.verdict === "FAIL"
      ? "REVIEW_FAIL"
      : params.spec.verdict === "PARTIAL" || quality?.verdict === "PARTIAL" || !quality
        ? "REVIEW_PARTIAL"
        : "REVIEW_PASS";
  const hasInvalidReport = !params.spec.valid || Boolean(quality && !quality.valid);
  const verdict =
    baseVerdict === "REVIEW_PASS" && hasInvalidReport ? "REVIEW_PARTIAL" : baseVerdict;
  const summaries = [params.spec.summary, quality?.summary].filter((entry): entry is string =>
    Boolean(entry?.trim()),
  );

  return {
    verdict,
    summary: summaries.join(" ") || "Review completed.",
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
