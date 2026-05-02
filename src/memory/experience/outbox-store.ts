import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.ts";
import type { NotebookLmExperienceWriteResult } from "../notebooklm/notebooklm-write.ts";
import type { MemoryKind } from "../recall/memory-kind.ts";
import type { UnifiedRecallLayer } from "../types/orchestration.ts";
import type { ExperienceNoteType, ExperienceNoteWriteInput } from "./note.ts";
import { renderExperienceNoteMarkdown } from "./note.ts";

export const EXPERIENCE_OUTBOX_STATUSES = ["active", "stale", "superseded", "archived"] as const;
export type ExperienceOutboxStatus = (typeof EXPERIENCE_OUTBOX_STATUSES)[number];
export const EXPERIENCE_SYNC_STATUSES = ["synced", "pending_sync", "failed"] as const;
export type ExperienceSyncStatus = (typeof EXPERIENCE_SYNC_STATUSES)[number];

export interface ExperienceOutboxEntry {
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
  status: ExperienceOutboxStatus;
  supersededBy: string | null;
  archivedAt: number | null;
  syncStatus?: ExperienceSyncStatus;
  syncAttempts?: number;
  lastSyncAttemptAt?: number | null;
  lastSyncError?: string | null;
  updatedAt: number;
}

type ExperienceOutboxFile = {
  version: 1;
  entries: ExperienceOutboxEntry[];
};

type ReadExperienceOutboxOptions = {
  status?: ExperienceOutboxStatus;
  recallableOnly?: boolean;
};

type PruneExperienceOutboxInput = {
  now?: number;
  staleAfterMs?: number;
  archiveAfterMs?: number;
};

export type PruneExperienceOutboxResult = {
  total: number;
  retainedIds: string[];
  staleIds: string[];
  archivedIds: string[];
};

function resolveExperienceOutboxPath(): string {
  return path.join(resolveStateDir(), "experience", "outbox.json");
}

let experienceOutboxWriteQueue = Promise.resolve();

async function withExperienceOutboxMutation<T>(fn: () => Promise<T>): Promise<T> {
  const previous = experienceOutboxWriteQueue;
  let release!: () => void;
  experienceOutboxWriteQueue = new Promise<void>((resolve) => {
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

function normalizeExperienceOutboxStatus(value: unknown): ExperienceOutboxStatus {
  return typeof value === "string" &&
    (EXPERIENCE_OUTBOX_STATUSES as readonly string[]).includes(value)
    ? (value as ExperienceOutboxStatus)
    : "active";
}

function normalizeExperienceSyncStatus(
  value: unknown,
  entry?: Partial<ExperienceOutboxEntry> | null,
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

function normalizeExperienceOutboxEntry(raw: unknown): ExperienceOutboxEntry | null {
  const entry = raw as Partial<ExperienceOutboxEntry> | null;
  if (!entry?.id) {
    return null;
  }
  const status = normalizeExperienceOutboxStatus(entry.status);
  const syncStatus = normalizeExperienceSyncStatus(entry.syncStatus, entry);
  return {
    ...(entry as ExperienceOutboxEntry),
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

async function readOutboxFile(): Promise<ExperienceOutboxFile> {
  try {
    const raw = await fs.readFile(resolveExperienceOutboxPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ExperienceOutboxFile>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .map((entry) => normalizeExperienceOutboxEntry(entry))
          .filter((entry): entry is ExperienceOutboxEntry => Boolean(entry))
      : [];
    return { version: 1, entries };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, entries: [] };
    }
    throw error;
  }
}

async function writeOutboxFile(outbox: ExperienceOutboxFile): Promise<void> {
  const filePath = resolveExperienceOutboxPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(outbox, null, 2)}\n`, "utf8");
}

function isRecallableExperienceOutboxEntry(entry: ExperienceOutboxEntry): boolean {
  return entry.status === "active" || entry.status === "stale";
}

function isPendingExperienceOutboxEntry(entry: ExperienceOutboxEntry): boolean {
  return (
    isRecallableExperienceOutboxEntry(entry) &&
    (entry.syncStatus === "pending_sync" || entry.syncStatus === "failed")
  );
}

export async function readExperienceOutboxEntries(
  limit = 200,
  options: ReadExperienceOutboxOptions = {},
): Promise<ExperienceOutboxEntry[]> {
  const outbox = await readOutboxFile();
  return outbox.entries
    .filter((entry) => !options.status || entry.status === options.status)
    .filter((entry) => !options.recallableOnly || isRecallableExperienceOutboxEntry(entry))
    .toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
    )
    .slice(0, Math.max(0, limit));
}

export async function readPendingExperienceOutboxEntries(
  limit = 200,
): Promise<ExperienceOutboxEntry[]> {
  const outbox = await readOutboxFile();
  return outbox.entries
    .filter(isPendingExperienceOutboxEntry)
    .toSorted(
      (left, right) =>
        (left.lastSyncAttemptAt ?? 0) - (right.lastSyncAttemptAt ?? 0) ||
        right.updatedAt - left.updatedAt ||
        left.title.localeCompare(right.title),
    )
    .slice(0, Math.max(0, limit));
}

export async function upsertExperienceOutboxEntry(params: {
  note: ExperienceNoteWriteInput;
  writeResult: NotebookLmExperienceWriteResult;
  updatedAt?: number;
}): Promise<ExperienceOutboxEntry> {
  return await upsertExperienceOutboxEntryFromNote({
    note: params.note,
    title: params.writeResult.title,
    notebookId: params.writeResult.notebookId,
    noteId: params.writeResult.noteId ?? null,
    syncStatus: "synced",
    updatedAt: params.updatedAt,
  });
}

export async function upsertExperienceOutboxEntryFromNote(params: {
  note: ExperienceNoteWriteInput;
  title?: string;
  notebookId?: string;
  noteId?: string | null;
  syncStatus?: ExperienceSyncStatus;
  syncError?: string | null;
  syncAttempts?: number;
  lastSyncAttemptAt?: number | null;
  updatedAt?: number;
}): Promise<ExperienceOutboxEntry> {
  return await withExperienceOutboxMutation(async () => {
    const dedupeKey = params.note.dedupeKey?.trim() || null;
    const stableKey = dedupeKey ?? params.noteId ?? params.note.title.trim();
    const entry: ExperienceOutboxEntry = {
      id: `experience-outbox:${slugifyId(stableKey)}`,
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

    const outbox = await readOutboxFile();
    const filtered = outbox.entries.filter(
      (candidate) =>
        candidate.id !== entry.id &&
        !(entry.noteId && candidate.noteId === entry.noteId) &&
        !(entry.dedupeKey && candidate.dedupeKey === entry.dedupeKey),
    );
    await writeOutboxFile({
      version: 1,
      entries: [entry, ...filtered].slice(0, 200),
    });
    return entry;
  });
}

export async function markExperienceOutboxEntrySyncFailed(params: {
  id: string;
  error: string;
  attemptedAt?: number;
}): Promise<ExperienceOutboxEntry | null> {
  return await withExperienceOutboxMutation(async () => {
    const id = params.id.trim();
    if (!id) {
      return null;
    }
    const outbox = await readOutboxFile();
    const attemptedAt = params.attemptedAt ?? Date.now();
    let updatedEntry: ExperienceOutboxEntry | null = null;
    const entries = outbox.entries.map((entry) => {
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
    await writeOutboxFile({ version: 1, entries });
    return updatedEntry;
  });
}

export async function markExperienceOutboxEntryPendingSync(params: {
  id: string;
  error?: string | null;
  updatedAt?: number;
}): Promise<ExperienceOutboxEntry | null> {
  return await withExperienceOutboxMutation(async () => {
    const id = params.id.trim();
    if (!id) {
      return null;
    }
    const outbox = await readOutboxFile();
    const updatedAt = params.updatedAt ?? Date.now();
    let updatedEntry: ExperienceOutboxEntry | null = null;
    const entries = outbox.entries.map((entry) => {
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
    await writeOutboxFile({ version: 1, entries });
    return updatedEntry;
  });
}

export async function markExperienceOutboxEntrySynced(params: {
  id: string;
  noteId?: string | null;
  notebookId: string;
  attemptedAt?: number;
}): Promise<ExperienceOutboxEntry | null> {
  return await withExperienceOutboxMutation(async () => {
    const id = params.id.trim();
    if (!id) {
      return null;
    }
    const outbox = await readOutboxFile();
    const attemptedAt = params.attemptedAt ?? Date.now();
    let updatedEntry: ExperienceOutboxEntry | null = null;
    const entries = outbox.entries.map((entry) => {
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
    await writeOutboxFile({ version: 1, entries });
    return updatedEntry;
  });
}

export async function removeExperienceOutboxEntry(params: {
  id: string;
}): Promise<ExperienceOutboxEntry | null> {
  return await withExperienceOutboxMutation(async () => {
    const id = params.id.trim();
    if (!id) {
      return null;
    }
    const outbox = await readOutboxFile();
    const removed = outbox.entries.find((entry) => entry.id === id) ?? null;
    if (!removed) {
      return null;
    }
    await writeOutboxFile({
      version: 1,
      entries: outbox.entries.filter((entry) => entry.id !== id),
    });
    return removed;
  });
}

export async function updateExperienceOutboxEntryStatus(params: {
  id: string;
  status: ExperienceOutboxStatus;
  supersededBy?: string | null;
  updatedAt?: number;
}): Promise<ExperienceOutboxEntry | null> {
  return await withExperienceOutboxMutation(async () => {
    const id = params.id.trim();
    if (!id) {
      return null;
    }
    const outbox = await readOutboxFile();
    const updatedAt = params.updatedAt ?? Date.now();
    let updatedEntry: ExperienceOutboxEntry | null = null;
    const entries = outbox.entries.map((entry) => {
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
    await writeOutboxFile({ version: 1, entries });
    return updatedEntry;
  });
}

export async function pruneExperienceOutboxEntries(
  params: PruneExperienceOutboxInput = {},
): Promise<PruneExperienceOutboxResult> {
  return await withExperienceOutboxMutation(async () => {
    const now = params.now ?? Date.now();
    const staleAfterMs = Math.max(0, params.staleAfterMs ?? 90 * 86_400_000);
    const archiveAfterMs = Math.max(staleAfterMs, params.archiveAfterMs ?? 180 * 86_400_000);
    const outbox = await readOutboxFile();
    const retainedIds: string[] = [];
    const staleIds: string[] = [];
    const archivedIds: string[] = [];
    const entries = outbox.entries.map((entry) => {
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
      await writeOutboxFile({ version: 1, entries });
    }
    return {
      total: entries.length,
      retainedIds,
      staleIds,
      archivedIds,
    };
  });
}
