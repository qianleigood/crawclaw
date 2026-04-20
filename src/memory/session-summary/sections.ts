import { parseSessionSummaryDocument } from "./template.ts";

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
  const normalized = normalizeLineEndings(content ?? "").trim();
  if (!normalized) {
    return "";
  }
  return normalized;
}
