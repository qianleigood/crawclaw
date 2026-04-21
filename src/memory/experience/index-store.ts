import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.ts";
import type { NotebookLmExperienceWriteResult } from "../notebooklm/notebooklm-write.ts";
import type { MemoryKind } from "../recall/memory-kind.ts";
import { tokenizeRecallText } from "../recall/query-analysis.ts";
import type { UnifiedRecallItem, UnifiedRecallLayer } from "../types/orchestration.ts";
import type { ExperienceNoteType, ExperienceNoteWriteInput } from "./note.ts";
import { renderExperienceNoteMarkdown } from "./note.ts";

export interface ExperienceIndexEntry {
  id: string;
  title: string;
  summary: string;
  content: string;
  type: ExperienceNoteType;
  layer: UnifiedRecallLayer;
  memoryKind: MemoryKind;
  noteId: string | null;
  notebookId: string;
  dedupeKey: string | null;
  aliases: string[];
  tags: string[];
  updatedAt: number;
}

type ExperienceIndexFile = {
  version: 1;
  entries: ExperienceIndexEntry[];
};

function resolveExperienceIndexPath(): string {
  return path.join(resolveStateDir(), "experience", "index.json");
}

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function slugifyId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "note";
}

function layerForType(type: ExperienceNoteType): UnifiedRecallLayer {
  if (type === "procedure") {
    return "sop";
  }
  if (type === "decision") {
    return "key_decisions";
  }
  if (type === "runtime_pattern" || type === "failure_pattern") {
    return "runtime_signals";
  }
  if (type === "workflow_pattern") {
    return "sop";
  }
  return "sources";
}

function memoryKindForType(type: ExperienceNoteType): MemoryKind {
  if (type === "procedure" || type === "workflow_pattern") {
    return "procedure";
  }
  if (type === "decision") {
    return "decision";
  }
  if (type === "runtime_pattern" || type === "failure_pattern") {
    return "runtime_pattern";
  }
  return "reference";
}

async function readIndexFile(): Promise<ExperienceIndexFile> {
  try {
    const raw = await fs.readFile(resolveExperienceIndexPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ExperienceIndexFile>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.filter((entry): entry is ExperienceIndexEntry => Boolean(entry?.id))
      : [];
    return { version: 1, entries };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, entries: [] };
    }
    throw error;
  }
}

async function writeIndexFile(index: ExperienceIndexFile): Promise<void> {
  const filePath = resolveExperienceIndexPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

export async function readExperienceIndexEntries(limit = 200): Promise<ExperienceIndexEntry[]> {
  const index = await readIndexFile();
  return index.entries
    .toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
    )
    .slice(0, Math.max(0, limit));
}

export async function upsertExperienceIndexEntry(params: {
  note: ExperienceNoteWriteInput;
  writeResult: NotebookLmExperienceWriteResult;
  updatedAt?: number;
}): Promise<ExperienceIndexEntry> {
  const dedupeKey = params.note.dedupeKey?.trim() || null;
  const stableKey = dedupeKey ?? params.writeResult.noteId ?? params.note.title.trim();
  const entry: ExperienceIndexEntry = {
    id: `experience-index:${slugifyId(stableKey)}`,
    title: params.writeResult.title.trim() || params.note.title.trim(),
    summary: params.note.summary.trim(),
    content: renderExperienceNoteMarkdown(params.note),
    type: params.note.type,
    layer: layerForType(params.note.type),
    memoryKind: memoryKindForType(params.note.type),
    noteId: params.writeResult.noteId ?? null,
    notebookId: params.writeResult.notebookId,
    dedupeKey,
    aliases: normalizeList(params.note.aliases),
    tags: normalizeList(params.note.tags),
    updatedAt: params.updatedAt ?? Date.now(),
  };

  const index = await readIndexFile();
  const filtered = index.entries.filter(
    (candidate) =>
      candidate.id !== entry.id &&
      !(entry.noteId && candidate.noteId === entry.noteId) &&
      !(entry.dedupeKey && candidate.dedupeKey === entry.dedupeKey),
  );
  await writeIndexFile({
    version: 1,
    entries: [entry, ...filtered].slice(0, 200),
  });
  return entry;
}

function scoreEntry(params: {
  entry: ExperienceIndexEntry;
  queryTokens: string[];
  targetLayers?: UnifiedRecallLayer[];
}): number {
  const haystack = new Set(
    tokenizeRecallText(
      [
        params.entry.title,
        params.entry.summary,
        params.entry.content,
        ...params.entry.aliases,
        ...params.entry.tags,
      ].join(" "),
    ),
  );
  const overlap = params.queryTokens.filter((token) => haystack.has(token)).length;
  const layerBoost = params.targetLayers?.includes(params.entry.layer) ? 0.35 : 0;
  const titleBoost = params.queryTokens.some((token) => params.entry.title.includes(token))
    ? 0.25
    : 0;
  const recencyBoost = Math.max(
    0,
    0.15 - ((Date.now() - params.entry.updatedAt) / 86_400_000) * 0.01,
  );
  return overlap * 0.12 + layerBoost + titleBoost + recencyBoost;
}

export async function searchExperienceIndexEntries(params: {
  query: string;
  limit?: number;
  targetLayers?: UnifiedRecallLayer[];
}): Promise<UnifiedRecallItem[]> {
  const limit = Math.max(0, Math.min(params.limit ?? 5, 10));
  if (!limit || !params.query.trim()) {
    return [];
  }
  const queryTokens = tokenizeRecallText(params.query).filter((token) => token.length >= 2);
  if (!queryTokens.length) {
    return [];
  }
  const entries = await readExperienceIndexEntries(80);
  return entries
    .map((entry) => ({
      entry,
      score: scoreEntry({ entry, queryTokens, targetLayers: params.targetLayers }),
    }))
    .filter((candidate) => candidate.score > 0)
    .toSorted(
      (left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt,
    )
    .slice(0, limit)
    .map(({ entry, score }) => ({
      id: entry.id,
      source: "local_experience_index",
      title: entry.title,
      summary: entry.summary,
      content: entry.content,
      layer: entry.layer,
      memoryKind: entry.memoryKind,
      retrievalScore: Math.min(0.92, 0.45 + score),
      importance: 0.68,
      updatedAt: entry.updatedAt,
      canonicalKey: entry.dedupeKey ?? entry.noteId ?? entry.title,
      sourceRef: entry.noteId ?? entry.dedupeKey ?? entry.title,
      metadata: {
        indexSource: "local_experience_index",
        notebookId: entry.notebookId,
        noteId: entry.noteId,
        dedupeKey: entry.dedupeKey,
        aliases: entry.aliases,
        tags: entry.tags,
      },
    }));
}
