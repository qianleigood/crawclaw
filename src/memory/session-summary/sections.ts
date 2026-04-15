import { estimateTokenCount } from "../recall/token-estimate.ts";
import {
  getSessionSummarySectionHeading,
  parseSessionSummaryDocument,
  SESSION_SUMMARY_SECTION_ORDER,
} from "./template.ts";

export const DEFAULT_SESSION_SUMMARY_TEMPLATE = `# Session Title
_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_

# Current State
_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._

# Task specification
_What did the user ask to build? Any design decisions or other explanatory context_

# Files and Functions
_What are the important files? In short, what do they contain and why are they relevant?_

# Workflow
_What bash commands are usually run and in what order? How to interpret their output if not obvious?_

# Errors & Corrections
_Errors encountered and how they were fixed. What did the user correct? What approaches failed and should not be tried again?_

# Codebase and System Documentation
_What are the important system components? How do they work/fit together?_

# Learnings
_What has worked well? What has not? What to avoid? Do not duplicate items from other sections_

# Key results
_If the user asked a specific output such as an answer to a question, a table, or other document, repeat the exact result here_

# Worklog
_Step by step, what was attempted, done? Very terse summary for each step_
`;

const PROMPT_SECTION_ORDER = [
  "Current State",
  "Task specification",
  "Key results",
  "Errors & Corrections",
] as const;

type SessionSummarySection = {
  heading: string;
  instruction?: string;
  body: string;
};

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function compactText(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {return "";}
  if (normalized.length <= limit) {return normalized;}
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function parseSessionSummarySections(content: string | null | undefined): SessionSummarySection[] {
  const document = parseSessionSummaryDocument(normalizeLineEndings(content ?? ""));
  if (!document) {return [];}
  return SESSION_SUMMARY_SECTION_ORDER.map((key) => ({
    heading: getSessionSummarySectionHeading(key),
    body: (document.sections[key] ?? []).join("\n").trim(),
  }));
}

export function isSessionSummaryEffectivelyEmpty(content: string | null | undefined): boolean {
  const sections = parseSessionSummarySections(content);
  if (!sections.length) {
    return true;
  }
  return sections.every((section) => !section.body.trim());
}

export function renderSessionSummaryPromptSection(
  content: string | null | undefined,
  tokenBudget: number,
): { text: string; estimatedTokens: number } | null {
  const sections = parseSessionSummarySections(content);
  if (!sections.length) {
    return null;
  }
  const selectedLines: string[] = ["## Session memory"];
  for (const heading of PROMPT_SECTION_ORDER) {
    const section = sections.find((entry) => entry.heading === heading);
    const body = compactText(section?.body ?? "", 480);
    if (!body) {
      continue;
    }
    selectedLines.push(`- ${heading}: ${body}`);
  }
  if (selectedLines.length === 1) {
    const fallback = compactText(
      sections
        .map((section) => `${section.heading}: ${section.body}`)
        .filter((line) => !line.endsWith(": "))
        .join("\n"),
      Math.max(240, tokenBudget * 8),
    );
    if (!fallback) {
      return null;
    }
    selectedLines.push(fallback);
  }

  let text = selectedLines.join("\n");
  while (estimateTokenCount(text) > tokenBudget && text.length > 120) {
    text = compactText(text, Math.max(120, Math.floor(text.length * 0.88)));
  }
  const estimatedTokens = estimateTokenCount(text);
  if (estimatedTokens > tokenBudget) {
    return null;
  }
  return { text, estimatedTokens };
}

export function renderSessionSummaryForCompaction(content: string | null | undefined): string {
  const normalized = normalizeLineEndings(content ?? "").trim();
  if (!normalized) {
    return "";
  }
  return normalized;
}
