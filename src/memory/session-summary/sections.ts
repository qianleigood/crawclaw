import { estimateTokenCount } from "../recall/token-estimate.ts";
import {
  getSessionSummarySectionText,
  parseSessionSummaryDocument,
  type SessionSummarySectionKey,
} from "./template.ts";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function isSessionSummaryEffectivelyEmpty(content: string | null | undefined): boolean {
  const document = parseSessionSummaryDocument(normalizeLineEndings(content ?? ""));
  if (!document) {
    return true;
  }
  return Object.values(document.sections).every((entries) =>
    entries.every((entry) => entry.trim().length === 0),
  );
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const clean = text.trim();
  if (!clean || estimateTokenCount(clean) <= tokenBudget) {
    return clean;
  }
  let candidate = clean.slice(0, Math.max(1, tokenBudget * 4)).trimEnd();
  const suffix = "\n[truncated to fit compact summary budget]";
  while (candidate.length > 0 && estimateTokenCount(`${candidate}${suffix}`) > tokenBudget) {
    candidate = candidate.slice(0, Math.floor(candidate.length * 0.85)).trimEnd();
  }
  return candidate ? `${candidate}${suffix}` : "";
}

function applyCompactionTokenBudget(sections: string[], tokenBudget: number | undefined): string {
  if (typeof tokenBudget !== "number" || !Number.isFinite(tokenBudget) || tokenBudget <= 0) {
    return sections.join("\n\n");
  }
  const targetBudget = Math.floor(tokenBudget);
  let remainingBudget = targetBudget;
  const selected: string[] = [];
  for (const section of sections) {
    const sectionTokens = estimateTokenCount(section);
    if (sectionTokens <= remainingBudget) {
      selected.push(section);
      remainingBudget -= sectionTokens;
      continue;
    }
    if (selected.length === 0 || remainingBudget >= 24) {
      const [heading = "", ...bodyLines] = section.split("\n");
      const headingText = heading.trim();
      const headingTokens = estimateTokenCount(headingText);
      const bodyBudget = Math.max(1, remainingBudget - headingTokens);
      const body = truncateToTokenBudget(bodyLines.join("\n"), bodyBudget);
      if (headingText && body) {
        selected.push(`${headingText}\n${body}`);
      }
    }
    break;
  }
  return (selected.length ? selected : sections.slice(0, 1)).join("\n\n");
}

export function renderSessionSummaryForCompaction(
  content: string | null | undefined,
  options?: { tokenBudget?: number },
): string {
  const normalized = normalizeLineEndings(content ?? "");
  const document = parseSessionSummaryDocument(normalized);
  if (!document) {
    return "";
  }
  const sectionOrder: Array<{ key: SessionSummarySectionKey; heading: string }> = [
    { key: "currentState", heading: "Current State" },
    { key: "openLoops", heading: "Open Loops" },
    { key: "taskSpecification", heading: "Task Specification" },
    { key: "filesAndFunctions", heading: "Files and Functions" },
    { key: "workflow", heading: "Workflow" },
    { key: "errorsAndCorrections", heading: "Errors & Corrections" },
    { key: "keyResults", heading: "Key Results" },
  ];
  const sections = sectionOrder
    .map(({ key, heading }) => {
      const text = getSessionSummarySectionText(document, key).trim();
      if (!text) {
        return null;
      }
      return `## ${heading}\n${text}`;
    })
    .filter((section): section is string => Boolean(section));
  if (!sections.length) {
    return "";
  }
  return applyCompactionTokenBudget(sections, options?.tokenBudget);
}
