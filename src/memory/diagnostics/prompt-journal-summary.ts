import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { resolveUserPath } from "../../utils.js";
import type { MemoryPromptJournalEvent } from "./prompt-journal.ts";

export type PromptJournalSummaryInput = {
  file?: string;
  dir?: string;
  date?: string;
  days?: number;
};

export type PromptJournalSummary = {
  files: string[];
  dateBuckets: string[];
  totalEvents: number;
  stageCounts: Record<string, number>;
  uniqueSessions: number;
  promptAssembly: {
    count: number;
    avgEstimatedTokens: number | null;
    avgSystemPromptChars: number | null;
  };
  afterTurn: {
    decisionCounts: Record<string, number>;
    skipReasonCounts: Record<string, number>;
  };
  durableExtraction: {
    count: number;
    notesSavedTotal: number;
    nonZeroSaveCount: number;
    zeroSaveCount: number;
    saveRate: number | null;
    topReasons: Array<{ reason: string; count: number }>;
  };
  knowledgeWrite: {
    statusCounts: Record<string, number>;
    actionCounts: Record<string, number>;
    titles: Array<{ title: string; count: number }>;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function incrementCounter(target: Record<string, number>, key: string | null | undefined): void {
  if (!key) {
    return;
  }
  target[key] = (target[key] ?? 0) + 1;
}

function average(values: number[]): number | null {
  if (!values.length) {
    return null;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function resolveJournalDir(input?: string): string {
  return input
    ? resolveUserPath(input)
    : path.join(resolveStateDir(), "logs", "memory-prompt-journal");
}

async function listCandidateFiles(params: PromptJournalSummaryInput): Promise<string[]> {
  if (params.file) {
    return [resolveUserPath(params.file)];
  }
  const dir = resolveJournalDir(params.dir);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const files = entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .toSorted()
    .map((entry) => path.join(dir, entry));
  if (params.date?.trim()) {
    const target = `${params.date.trim()}.jsonl`;
    return files.filter((filePath) => path.basename(filePath) === target);
  }
  const days = Math.max(1, Math.floor(params.days ?? 1));
  return files.slice(-days);
}

async function readEventsFromFile(filePath: string): Promise<MemoryPromptJournalEvent[]> {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as MemoryPromptJournalEvent;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is MemoryPromptJournalEvent => Boolean(entry));
}

export async function summarizePromptJournal(
  params: PromptJournalSummaryInput = {},
): Promise<PromptJournalSummary> {
  const files = await listCandidateFiles(params);
  const events = (
    await Promise.all(
      files.map(async (filePath) => {
        try {
          return await readEventsFromFile(filePath);
        } catch {
          return [] as MemoryPromptJournalEvent[];
        }
      }),
    )
  ).flat();

  const stageCounts: Record<string, number> = {};
  const decisionCounts: Record<string, number> = {};
  const skipReasonCounts: Record<string, number> = {};
  const topReasonCounts: Record<string, number> = {};
  const knowledgeStatusCounts: Record<string, number> = {};
  const knowledgeActionCounts: Record<string, number> = {};
  const knowledgeTitleCounts: Record<string, number> = {};
  const sessionKeys = new Set<string>();
  const dateBuckets = new Set<string>();
  const promptEstimatedTokens: number[] = [];
  const promptChars: number[] = [];

  let durableCount = 0;
  let durableNotesSavedTotal = 0;
  let durableNonZeroSaveCount = 0;
  let durableZeroSaveCount = 0;
  let promptAssemblyCount = 0;

  for (const event of events) {
    incrementCounter(stageCounts, event.stage);
    if (event.sessionKey || event.sessionId) {
      sessionKeys.add(event.sessionKey ?? event.sessionId ?? "unknown");
    }
    if (event.dateBucket) {
      dateBuckets.add(event.dateBucket);
    }
    const payload = isRecord(event.payload) ? event.payload : {};

    if (event.stage === "prompt_assembly") {
      promptAssemblyCount += 1;
      if (typeof payload.estimatedTokens === "number") {
        promptEstimatedTokens.push(payload.estimatedTokens);
      }
      if (typeof payload.systemContextText === "string") {
        promptChars.push(payload.systemContextText.length);
      }
      continue;
    }

    if (event.stage === "after_turn_decision") {
      incrementCounter(
        decisionCounts,
        typeof payload.decision === "string" ? payload.decision : undefined,
      );
      incrementCounter(
        skipReasonCounts,
        typeof payload.skipReason === "string" ? payload.skipReason : undefined,
      );
      continue;
    }

    if (event.stage === "durable_extraction") {
      durableCount += 1;
      const notesSaved = typeof payload.notesSaved === "number" ? payload.notesSaved : 0;
      durableNotesSavedTotal += notesSaved;
      if (notesSaved === 0) {
        durableZeroSaveCount += 1;
      } else {
        durableNonZeroSaveCount += 1;
      }
      incrementCounter(
        topReasonCounts,
        typeof payload.reason === "string" ? payload.reason : undefined,
      );
      continue;
    }

    if (event.stage === "knowledge_write") {
      incrementCounter(
        knowledgeStatusCounts,
        typeof payload.status === "string" ? payload.status : undefined,
      );
      incrementCounter(
        knowledgeActionCounts,
        typeof payload.action === "string" ? payload.action : undefined,
      );
      incrementCounter(
        knowledgeTitleCounts,
        typeof payload.title === "string" ? payload.title : undefined,
      );
    }
  }

  return {
    files,
    dateBuckets: [...dateBuckets].toSorted(),
    totalEvents: events.length,
    stageCounts,
    uniqueSessions: sessionKeys.size,
    promptAssembly: {
      count: promptAssemblyCount,
      avgEstimatedTokens: average(promptEstimatedTokens),
      avgSystemPromptChars: average(promptChars),
    },
    afterTurn: {
      decisionCounts,
      skipReasonCounts,
    },
    durableExtraction: {
      count: durableCount,
      notesSavedTotal: durableNotesSavedTotal,
      nonZeroSaveCount: durableNonZeroSaveCount,
      zeroSaveCount: durableZeroSaveCount,
      saveRate:
        durableCount > 0 ? Number((durableNonZeroSaveCount / durableCount).toFixed(4)) : null,
      topReasons: Object.entries(topReasonCounts)
        .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 10)
        .map(([reason, count]) => ({ reason, count })),
    },
    knowledgeWrite: {
      statusCounts: knowledgeStatusCounts,
      actionCounts: knowledgeActionCounts,
      titles: Object.entries(knowledgeTitleCounts)
        .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 10)
        .map(([title, count]) => ({ title, count })),
    },
  };
}
