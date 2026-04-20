export const SESSION_SUMMARY_SECTION_ORDER = [
  "sessionTitle",
  "currentState",
  "openLoops",
  "taskSpecification",
  "filesAndFunctions",
  "workflow",
  "errorsAndCorrections",
  "codebaseAndSystemDocumentation",
  "learnings",
  "keyResults",
  "worklog",
] as const;

export type SessionSummarySectionKey = (typeof SESSION_SUMMARY_SECTION_ORDER)[number];
export type SessionSummaryProfile = "light" | "full";

export const SESSION_SUMMARY_LIGHT_SECTION_ORDER = [
  "currentState",
  "openLoops",
  "taskSpecification",
  "keyResults",
] as const satisfies readonly SessionSummarySectionKey[];

export const SESSION_SUMMARY_FULL_ONLY_SECTION_ORDER = [
  "filesAndFunctions",
  "workflow",
  "errorsAndCorrections",
  "codebaseAndSystemDocumentation",
  "learnings",
  "worklog",
] as const satisfies readonly SessionSummarySectionKey[];

const SESSION_SUMMARY_SECTION_HEADINGS: Record<SessionSummarySectionKey, string> = {
  sessionTitle: "Session Title",
  currentState: "Current State",
  openLoops: "Open Loops",
  taskSpecification: "Task specification",
  filesAndFunctions: "Files and Functions",
  workflow: "Workflow",
  errorsAndCorrections: "Errors & Corrections",
  codebaseAndSystemDocumentation: "Codebase and System Documentation",
  learnings: "Learnings",
  keyResults: "Key results",
  worklog: "Worklog",
};

const SESSION_SUMMARY_SECTION_INSTRUCTIONS: Record<SessionSummarySectionKey, string> = {
  sessionTitle:
    "_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_",
  currentState:
    "_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._",
  openLoops:
    "_Which work items, decisions, or follow-ups are still open right now? Keep this tightly focused on unresolved items._",
  taskSpecification:
    "_What did the user ask to build? Any design decisions or other explanatory context_",
  filesAndFunctions:
    "_What are the important files? In short, what do they contain and why are they relevant?_",
  workflow:
    "_What bash commands are usually run and in what order? How to interpret their output if not obvious?_",
  errorsAndCorrections:
    "_Errors encountered and how they were fixed. What did the user correct? What approaches failed and should not be tried again?_",
  codebaseAndSystemDocumentation:
    "_What are the important system components? How do they work/fit together?_",
  learnings:
    "_What has worked well? What has not? What to avoid? Do not duplicate items from other sections_",
  keyResults:
    "_If the user asked a specific output such as an answer to a question, a table, or other document, repeat the exact result here_",
  worklog: "_Step by step, what was attempted, done? Very terse summary for each step_",
};

export type SessionSummaryDocument = {
  sections: Partial<Record<SessionSummarySectionKey, string[]>>;
};

function normalizeLines(lines: string[] | undefined): string[] {
  return (lines ?? [])
    .map((line) => line.replace(/\s+$/u, "").trimEnd())
    .filter((line) => line.trim().length > 0);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function resolveSectionKeyFromHeading(heading: string): SessionSummarySectionKey | undefined {
  const normalized = heading.trim().toLowerCase();
  for (const key of SESSION_SUMMARY_SECTION_ORDER) {
    if (SESSION_SUMMARY_SECTION_HEADINGS[key].toLowerCase() === normalized) {
      return key;
    }
  }
  return undefined;
}

export function buildSessionSummaryTemplate(_params?: {
  sessionId?: string;
  updatedAt?: string;
}): string {
  return renderSessionSummaryDocument({
    sections: {},
  });
}

export function parseSessionSummaryDocument(
  text: string | null | undefined,
): SessionSummaryDocument | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  const lines = normalized.split("\n");
  const document: SessionSummaryDocument = {
    sections: {},
  };
  let currentSection: SessionSummarySectionKey | null = null;
  let skipNextInstructionLine = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const headingMatch = line.match(/^#{1,2}\s+(.+)$/u);
    if (headingMatch) {
      currentSection = resolveSectionKeyFromHeading(headingMatch[1] ?? "") ?? null;
      if (currentSection && !document.sections[currentSection]) {
        document.sections[currentSection] = [];
      }
      skipNextInstructionLine = Boolean(currentSection);
      continue;
    }

    if (skipNextInstructionLine) {
      if (!line.trim()) {
        continue;
      }
      if (currentSection && line.trim() === SESSION_SUMMARY_SECTION_INSTRUCTIONS[currentSection]) {
        skipNextInstructionLine = false;
        continue;
      }
      skipNextInstructionLine = false;
    }

    if (!currentSection) {
      continue;
    }
    const sectionLines = document.sections[currentSection] ?? [];
    sectionLines.push(line);
    document.sections[currentSection] = sectionLines;
  }

  for (const key of SESSION_SUMMARY_SECTION_ORDER) {
    document.sections[key] = normalizeLines(document.sections[key]);
  }
  return document;
}

export function renderSessionSummaryDocument(
  document: SessionSummaryDocument | null | undefined,
): string {
  const sections = document?.sections ?? {};
  const lines: string[] = [];
  for (const key of SESSION_SUMMARY_SECTION_ORDER) {
    lines.push(`# ${SESSION_SUMMARY_SECTION_HEADINGS[key]}`);
    lines.push(SESSION_SUMMARY_SECTION_INSTRUCTIONS[key]);
    lines.push("");
    const body = normalizeLines(sections[key]);
    if (body.length > 0) {
      lines.push(...body);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function renderSessionSummaryTemplate(params?: {
  sessionId?: string;
  updatedAt?: string;
}): string {
  return buildSessionSummaryTemplate(params);
}

export function getSessionSummarySectionText(
  document: SessionSummaryDocument | null | undefined,
  key: SessionSummarySectionKey,
): string {
  return normalizeLines(document?.sections?.[key]).join("\n");
}

export function extractSessionSummarySectionText(
  text: string | null | undefined,
  key: SessionSummarySectionKey,
): string {
  return getSessionSummarySectionText(parseSessionSummaryDocument(text), key);
}

export function getSessionSummarySectionHeading(key: SessionSummarySectionKey): string {
  return SESSION_SUMMARY_SECTION_HEADINGS[key];
}

export function getSessionSummarySectionInstruction(key: SessionSummarySectionKey): string {
  return SESSION_SUMMARY_SECTION_INSTRUCTIONS[key];
}

export function inferSessionSummaryProfile(
  document: SessionSummaryDocument | null | undefined,
): SessionSummaryProfile | null {
  const hasAnyLightSection = SESSION_SUMMARY_LIGHT_SECTION_ORDER.some(
    (key) => getSessionSummarySectionText(document, key).trim().length > 0,
  );
  const hasAnyFullOnlySection = SESSION_SUMMARY_FULL_ONLY_SECTION_ORDER.some(
    (key) => getSessionSummarySectionText(document, key).trim().length > 0,
  );
  if (hasAnyFullOnlySection) {
    return "full";
  }
  return hasAnyLightSection ? "light" : null;
}
