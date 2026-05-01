import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.ts";
import type { NotebookLmExperienceWriteResult } from "../notebooklm/notebooklm-write.ts";
import type { MemoryKind } from "../recall/memory-kind.ts";
import type { UnifiedRecallLayer } from "../types/orchestration.ts";
import type { ExperienceNoteType, ExperienceNoteWriteInput } from "./note.ts";
import { renderExperienceNoteMarkdown } from "./note.ts";

export const EXPERIENCE_INDEX_STATUSES = ["active", "stale", "superseded", "archived"] as const;
export type ExperienceIndexStatus = (typeof EXPERIENCE_INDEX_STATUSES)[number];
export const EXPERIENCE_SYNC_STATUSES = ["synced", "pending_sync", "failed"] as const;
export type ExperienceSyncStatus = (typeof EXPERIENCE_SYNC_STATUSES)[number];

export interface ExperienceIndexEntry {
  id: string;
  title: string;
  summary: string;
  content: string;
  note?: ExperienceNoteWriteInput | null;
  type: ExperienceNoteType;
  layer: UnifiedRecallLayer;
  memoryKind: MemoryKind;
  noteId: string | null;
  notebookId: string;
  dedupeKey: string | null;
  aliases: string[];
  tags: string[];
  status: ExperienceIndexStatus;
  supersededBy: string | null;
  archivedAt: number | null;
  syncStatus?: ExperienceSyncStatus;
  syncAttempts?: number;
  lastSyncAttemptAt?: number | null;
  lastSyncError?: string | null;
  updatedAt: number;
}

type ExperienceIndexFile = {
  version: 1;
  entries: ExperienceIndexEntry[];
};

type ReadExperienceIndexOptions = {
  status?: ExperienceIndexStatus;
  recallableOnly?: boolean;
};

type PruneExperienceIndexInput = {
  now?: number;
  staleAfterMs?: number;
  archiveAfterMs?: number;
};

export type PruneExperienceIndexResult = {
  total: number;
  retainedIds: string[];
  staleIds: string[];
  archivedIds: string[];
};

function resolveExperienceIndexPath(): string {
  return path.join(resolveStateDir(), "experience", "index.json");
}

let experienceIndexWriteQueue = Promise.resolve();

async function withExperienceIndexMutation<T>(fn: () => Promise<T>): Promise<T> {
  const previous = experienceIndexWriteQueue;
  let release!: () => void;
  experienceIndexWriteQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

function normalizeList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeNullableTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeExperienceIndexStatus(value: unknown): ExperienceIndexStatus {
  return typeof value === "string" &&
    (EXPERIENCE_INDEX_STATUSES as readonly string[]).includes(value)
    ? (value as ExperienceIndexStatus)
    : "active";
}

function normalizeExperienceSyncStatus(
  value: unknown,
  entry?: Partial<ExperienceIndexEntry> | null,
): ExperienceSyncStatus {
  if (
    typeof value === "string" &&
    (EXPERIENCE_SYNC_STATUSES as readonly string[]).includes(value)
  ) {
    return value as ExperienceSyncStatus;
  }
  return entry?.noteId || (entry?.notebookId && entry.notebookId !== "local")
    ? "synced"
    : "pending_sync";
}

function normalizeCounter(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeExperienceIndexEntry(raw: unknown): ExperienceIndexEntry | null {
  const entry = raw as Partial<ExperienceIndexEntry> | null;
  if (!entry?.id) {
    return null;
  }
  const status = normalizeExperienceIndexStatus(entry.status);
  const syncStatus = normalizeExperienceSyncStatus(entry.syncStatus, entry);
  return {
    ...(entry as ExperienceIndexEntry),
    note: entry.note ?? null,
    status,
    supersededBy: status === "superseded" ? normalizeNullableString(entry.supersededBy) : null,
    archivedAt: status === "archived" ? normalizeNullableTimestamp(entry.archivedAt) : null,
    syncStatus,
    syncAttempts: normalizeCounter(entry.syncAttempts),
    lastSyncAttemptAt: normalizeNullableTimestamp(entry.lastSyncAttemptAt),
    lastSyncError: normalizeNullableString(entry.lastSyncError),
  };
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
      ? parsed.entries
          .map((entry) => normalizeExperienceIndexEntry(entry))
          .filter((entry): entry is ExperienceIndexEntry => Boolean(entry))
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

function isRecallableExperienceIndexEntry(entry: ExperienceIndexEntry): boolean {
  return entry.status === "active" || entry.status === "stale";
}

function isPendingExperienceIndexEntry(entry: ExperienceIndexEntry): boolean {
  return (
    isRecallableExperienceIndexEntry(entry) &&
    (entry.syncStatus === "pending_sync" || entry.syncStatus === "failed")
  );
}

export async function readExperienceIndexEntries(
  limit = 200,
  options: ReadExperienceIndexOptions = {},
): Promise<ExperienceIndexEntry[]> {
  const index = await readIndexFile();
  return index.entries
    .filter((entry) => !options.status || entry.status === options.status)
    .filter((entry) => !options.recallableOnly || isRecallableExperienceIndexEntry(entry))
    .toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
    )
    .slice(0, Math.max(0, limit));
}

export async function readPendingExperienceIndexEntries(
  limit = 200,
): Promise<ExperienceIndexEntry[]> {
  const index = await readIndexFile();
  return index.entries
    .filter(isPendingExperienceIndexEntry)
    .toSorted(
      (left, right) =>
        (left.lastSyncAttemptAt ?? 0) - (right.lastSyncAttemptAt ?? 0) ||
        right.updatedAt - left.updatedAt ||
        left.title.localeCompare(right.title),
    )
    .slice(0, Math.max(0, limit));
}

export async function upsertExperienceIndexEntry(params: {
  note: ExperienceNoteWriteInput;
  writeResult: NotebookLmExperienceWriteResult;
  updatedAt?: number;
}): Promise<ExperienceIndexEntry> {
  return await upsertExperienceIndexEntryFromNote({
    note: params.note,
    title: params.writeResult.title,
    notebookId: params.writeResult.notebookId,
    noteId: params.writeResult.noteId ?? null,
    syncStatus: "synced",
    updatedAt: params.updatedAt,
  });
}

export async function upsertExperienceIndexEntryFromNote(params: {
  note: ExperienceNoteWriteInput;
  title?: string;
  notebookId?: string;
  noteId?: string | null;
  syncStatus?: ExperienceSyncStatus;
  syncError?: string | null;
  syncAttempts?: number;
  lastSyncAttemptAt?: number | null;
  updatedAt?: number;
}): Promise<ExperienceIndexEntry> {
  return await withExperienceIndexMutation(async () => {
    const dedupeKey = params.note.dedupeKey?.trim() || null;
    const stableKey = dedupeKey ?? params.noteId ?? params.note.title.trim();
    const entry: ExperienceIndexEntry = {
      id: `experience-index:${slugifyId(stableKey)}`,
      title: params.title?.trim() || params.note.title.trim(),
      summary: params.note.summary.trim(),
      content: renderExperienceNoteMarkdown(params.note),
      note: params.note,
      type: params.note.type,
      layer: layerForType(params.note.type),
      memoryKind: memoryKindForType(params.note.type),
      noteId: params.noteId ?? null,
      notebookId: params.notebookId?.trim() || "local",
      dedupeKey,
      aliases: normalizeList(params.note.aliases),
      tags: normalizeList(params.note.tags),
      status: "active",
      supersededBy: null,
      archivedAt: null,
      syncStatus:
        params.syncStatus ??
        (params.noteId || (params.notebookId && params.notebookId.trim() !== "local")
          ? "synced"
          : "pending_sync"),
      syncAttempts: normalizeCounter(params.syncAttempts),
      lastSyncAttemptAt: params.lastSyncAttemptAt ?? null,
      lastSyncError: normalizeNullableString(params.syncError),
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
  });
}

export async function markExperienceIndexEntrySyncFailed(params: {
  id: string;
  error: string;
  attemptedAt?: number;
}): Promise<ExperienceIndexEntry | null> {
  return await withExperienceIndexMutation(async () => {
    const id = params.id.trim();
    if (!id) {
      return null;
    }
    const index = await readIndexFile();
    const attemptedAt = params.attemptedAt ?? Date.now();
    let updatedEntry: ExperienceIndexEntry | null = null;
    const entries = index.entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      updatedEntry = {
        ...entry,
        syncStatus: "failed",
        syncAttempts: (entry.syncAttempts ?? 0) + 1,
        lastSyncAttemptAt: attemptedAt,
        lastSyncError: params.error.trim() || "NotebookLM sync failed",
        updatedAt: attemptedAt,
      };
      return updatedEntry;
    });
    if (!updatedEntry) {
      return null;
    }
    await writeIndexFile({ version: 1, entries });
    return updatedEntry;
  });
}

export async function markExperienceIndexEntryPendingSync(params: {
  id: string;
  error?: string | null;
  updatedAt?: number;
}): Promise<ExperienceIndexEntry | null> {
  return await withExperienceIndexMutation(async () => {
    const id = params.id.trim();
    if (!id) {
      return null;
    }
    const index = await readIndexFile();
    const updatedAt = params.updatedAt ?? Date.now();
    let updatedEntry: ExperienceIndexEntry | null = null;
    const entries = index.entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      updatedEntry = {
        ...entry,
        syncStatus: "pending_sync",
        lastSyncError: normalizeNullableString(params.error),
        updatedAt,
      };
      return updatedEntry;
    });
    if (!updatedEntry) {
      return null;
    }
    await writeIndexFile({ version: 1, entries });
    return updatedEntry;
  });
}

export async function markExperienceIndexEntrySynced(params: {
  id: string;
  noteId?: string | null;
  notebookId: string;
  attemptedAt?: number;
}): Promise<ExperienceIndexEntry | null> {
  return await withExperienceIndexMutation(async () => {
    const id = params.id.trim();
    if (!id) {
      return null;
    }
    const index = await readIndexFile();
    const attemptedAt = params.attemptedAt ?? Date.now();
    let updatedEntry: ExperienceIndexEntry | null = null;
    const entries = index.entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      updatedEntry = {
        ...entry,
        noteId: params.noteId ?? entry.noteId,
        notebookId: params.notebookId.trim() || entry.notebookId,
        syncStatus: "synced",
        syncAttempts: (entry.syncAttempts ?? 0) + 1,
        lastSyncAttemptAt: attemptedAt,
        lastSyncError: null,
        updatedAt: attemptedAt,
      };
      return updatedEntry;
    });
    if (!updatedEntry) {
      return null;
    }
    await writeIndexFile({ version: 1, entries });
    return updatedEntry;
  });
}

export async function updateExperienceIndexEntryStatus(params: {
  id: string;
  status: ExperienceIndexStatus;
  supersededBy?: string | null;
  updatedAt?: number;
}): Promise<ExperienceIndexEntry | null> {
  return await withExperienceIndexMutation(async () => {
    const id = params.id.trim();
    if (!id) {
      return null;
    }
    const index = await readIndexFile();
    const updatedAt = params.updatedAt ?? Date.now();
    let updatedEntry: ExperienceIndexEntry | null = null;
    const entries = index.entries.map((entry) => {
      if (entry.id !== id) {
        return entry;
      }
      updatedEntry = {
        ...entry,
        status: params.status,
        supersededBy:
          params.status === "superseded" ? normalizeNullableString(params.supersededBy) : null,
        archivedAt: params.status === "archived" ? updatedAt : null,
        updatedAt,
      };
      return updatedEntry;
    });
    if (!updatedEntry) {
      return null;
    }
    await writeIndexFile({ version: 1, entries });
    return updatedEntry;
  });
}

export async function pruneExperienceIndexEntries(
  params: PruneExperienceIndexInput = {},
): Promise<PruneExperienceIndexResult> {
  return await withExperienceIndexMutation(async () => {
    const now = params.now ?? Date.now();
    const staleAfterMs = Math.max(0, params.staleAfterMs ?? 90 * 86_400_000);
    const archiveAfterMs = Math.max(staleAfterMs, params.archiveAfterMs ?? 180 * 86_400_000);
    const index = await readIndexFile();
    const retainedIds: string[] = [];
    const staleIds: string[] = [];
    const archivedIds: string[] = [];
    const entries = index.entries.map((entry) => {
      if (entry.status === "archived" || entry.status === "superseded") {
        return entry;
      }
      const ageMs = Math.max(0, now - entry.updatedAt);
      if (entry.status === "stale" && ageMs >= archiveAfterMs) {
        archivedIds.push(entry.id);
        return {
          ...entry,
          status: "archived" as const,
          archivedAt: now,
          updatedAt: now,
        };
      }
      if (entry.status === "active" && ageMs >= staleAfterMs) {
        staleIds.push(entry.id);
        return {
          ...entry,
          status: "stale" as const,
          updatedAt: now,
        };
      }
      retainedIds.push(entry.id);
      return entry;
    });
    if (staleIds.length || archivedIds.length) {
      await writeIndexFile({ version: 1, entries });
    }
    return {
      total: entries.length,
      retainedIds,
      staleIds,
      archivedIds,
    };
  });
}
