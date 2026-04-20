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

export function renderSessionSummaryForCompaction(content: string | null | undefined): string {
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
  return sections.join("\n\n");
}
