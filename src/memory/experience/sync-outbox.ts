import { normalizeNotebookLmConfig } from "../config/notebooklm.ts";
import { writeNotebookLmExperienceNoteViaCli } from "../notebooklm/notebooklm-write.ts";
import type { NotebookLmConfig, NotebookLmConfigInput } from "../types/config.ts";
import type { ExperienceNoteWriteInput } from "./note.ts";
import {
  markExperienceOutboxEntrySyncFailed,
  readPendingExperienceOutboxEntries,
  removeExperienceOutboxEntry,
  type ExperienceOutboxEntry,
} from "./outbox-store.ts";

type RuntimeLogger = { warn(message: string): void; info?(message: string): void };

export interface ExperienceSyncOutboxResult {
  status: "ok" | "skipped";
  scanned: number;
  synced: number;
  failed: number;
  skipped: boolean;
  errors: Array<{ id: string; error: string }>;
}

function fallbackNoteFromEntry(entry: ExperienceOutboxEntry): ExperienceNoteWriteInput {
  return {
    type: entry.type,
    title: entry.title,
    summary: entry.summary,
    context: entry.content,
    lesson: "该经验来自本地待同步队列，NotebookLM 恢复后需要补写入。",
    dedupeKey: entry.dedupeKey ?? entry.id,
    aliases: entry.aliases,
    tags: entry.tags,
  };
}

function resolveNotebookLmConfig(
  config?: NotebookLmConfig | NotebookLmConfigInput | null,
): NotebookLmConfig | undefined {
  return config ? normalizeNotebookLmConfig(config as NotebookLmConfigInput) : undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function flushPendingExperienceNotes(params: {
  config?: NotebookLmConfig | NotebookLmConfigInput | null;
  limit?: number;
  logger?: RuntimeLogger;
}): Promise<ExperienceSyncOutboxResult> {
  const config = resolveNotebookLmConfig(params.config);
  if (!config?.enabled) {
    return {
      status: "skipped",
      scanned: 0,
      synced: 0,
      failed: 0,
      skipped: true,
      errors: [],
    };
  }

  const pending = await readPendingExperienceOutboxEntries(params.limit ?? 25);
  const errors: Array<{ id: string; error: string }> = [];
  let synced = 0;
  let failed = 0;

  for (const entry of pending) {
    try {
      const note = entry.note ?? fallbackNoteFromEntry(entry);
      const result = await writeNotebookLmExperienceNoteViaCli({
        config,
        note,
        logger: params.logger,
      });
      if (!result?.noteId) {
        throw new Error("NotebookLM write did not return a note id");
      }
      await removeExperienceOutboxEntry({
        id: entry.id,
      });
      synced += 1;
    } catch (error) {
      const message = formatError(error);
      await markExperienceOutboxEntrySyncFailed({
        id: entry.id,
        error: message,
      });
      errors.push({ id: entry.id, error: message });
      failed += 1;
    }
  }

  return {
    status: "ok",
    scanned: pending.length,
    synced,
    failed,
    skipped: false,
    errors,
  };
}
