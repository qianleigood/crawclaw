import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { getQueuedFileWriter, type QueuedFileWriter } from "../../agents/queued-file-writer.js";
import { parseBooleanValue } from "../../utils/boolean.js";
import { safeJsonStringify } from "../../utils/safe-json.js";
import { resolveUserPath } from "../../utils.js";

// Debug-only prompt journal. This is intentionally lossy/truncated and is not the
// Context Archive truth layer used for replay/export.

export type MemoryPromptJournalStage =
  | "prompt_assembly"
  | "after_turn_decision"
  | "durable_extraction"
  | "knowledge_write";

export type MemoryPromptJournalEvent = {
  ts: string;
  dateBucket: string;
  stage: MemoryPromptJournalStage;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  channel?: string;
  userId?: string;
  payload: Record<string, unknown>;
};

type MemoryPromptJournalConfig = {
  enabled: boolean;
  filePath: string;
  dirPath: string | null;
  retentionDays: number | null;
};

export type MemoryPromptJournal = {
  enabled: true;
  filePath: string;
  recordStage: (stage: MemoryPromptJournalStage, payload: Partial<MemoryPromptJournalEvent>) => void;
};

const writers = new Map<string, QueuedFileWriter>();
let sharedJournal: MemoryPromptJournal | null | undefined;
const cleanupStarted = new Set<string>();

function formatLocalDateBucket(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveMemoryPromptJournalConfig(env: NodeJS.ProcessEnv): MemoryPromptJournalConfig {
  const enabled = parseBooleanValue(env.CRAWCLAW_MEMORY_PROMPT_JOURNAL) ?? false;
  const rawRetentionDays = env.CRAWCLAW_MEMORY_PROMPT_JOURNAL_RETENTION_DAYS?.trim();
  const parsedRetentionDays = rawRetentionDays ? Number.parseInt(rawRetentionDays, 10) : Number.NaN;
  const retentionDays = Number.isFinite(parsedRetentionDays) && parsedRetentionDays > 0
    ? Math.floor(parsedRetentionDays)
    : null;
  const fileOverride = env.CRAWCLAW_MEMORY_PROMPT_JOURNAL_FILE?.trim();
  if (fileOverride) {
    return {
      enabled,
      filePath: resolveUserPath(fileOverride, env),
      dirPath: null,
      retentionDays,
    };
  }
  const dirOverride = env.CRAWCLAW_MEMORY_PROMPT_JOURNAL_DIR?.trim();
  const dateBucket = formatLocalDateBucket(new Date());
  const baseDir = dirOverride
    ? resolveUserPath(dirOverride, env)
    : path.join(resolveStateDir(env), "logs", "memory-prompt-journal");
  return {
    enabled,
    filePath: path.join(baseDir, `${dateBucket}.jsonl`),
    dirPath: baseDir,
    retentionDays,
  };
}

function getWriter(filePath: string): QueuedFileWriter {
  return getQueuedFileWriter(writers, filePath);
}

async function prunePromptJournalDirectory(dirPath: string, retentionDays: number): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return;
  }
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".jsonl"))
      .map(async (entry) => {
        const filePath = path.join(dirPath, entry);
        try {
          const stat = await fs.stat(filePath);
          if (stat.mtimeMs < cutoff) {
            await fs.unlink(filePath);
          }
        } catch {
          // Best-effort cleanup only.
        }
      }),
  );
}

function maybeStartPromptJournalCleanup(config: MemoryPromptJournalConfig): void {
  if (!config.enabled || !config.dirPath || !config.retentionDays) {
    return;
  }
  const cleanupKey = `${config.dirPath}::${config.retentionDays}`;
  if (cleanupStarted.has(cleanupKey)) {
    return;
  }
  cleanupStarted.add(cleanupKey);
  void prunePromptJournalDirectory(config.dirPath, config.retentionDays);
}

function trimString(value: string, maxChars = 4000): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}…[truncated ${value.length - maxChars} chars]`;
}

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return trimString(value);
  }
  if (typeof value !== "object") {
    return value;
  }
  if (depth >= 4) {
    return "[MaxDepth]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizePayload(entry, depth + 1));
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    next[key] = sanitizePayload(entry, depth + 1);
  }
  return next;
}

export function createMemoryPromptJournal(params?: {
  env?: NodeJS.ProcessEnv;
  writer?: QueuedFileWriter;
}): MemoryPromptJournal | null {
  const env = params?.env ?? process.env;
  const config = resolveMemoryPromptJournalConfig(env);
  if (!config.enabled) {
    return null;
  }
  maybeStartPromptJournalCleanup(config);
  const writer = params?.writer ?? getWriter(config.filePath);

  return {
    enabled: true,
    filePath: config.filePath,
    recordStage: (stage, payload) => {
      const now = new Date();
      const event: MemoryPromptJournalEvent = {
        ts: now.toISOString(),
        dateBucket: formatLocalDateBucket(now),
        stage,
        sessionId: payload.sessionId,
        sessionKey: payload.sessionKey,
        agentId: payload.agentId,
        channel: payload.channel,
        userId: payload.userId,
        payload: (sanitizePayload(payload.payload ?? {}) as Record<string, unknown>) ?? {},
      };
      const line = safeJsonStringify(event);
      if (!line) {
        return;
      }
      writer.write(`${line}\n`);
    },
  };
}

export function getSharedMemoryPromptJournal(): MemoryPromptJournal | null {
  if (sharedJournal === undefined) {
    sharedJournal = createMemoryPromptJournal();
  }
  return sharedJournal ?? null;
}

export const __testing = {
  formatLocalDateBucket,
  prunePromptJournalDirectory,
  resetSharedMemoryPromptJournal(): void {
    sharedJournal = undefined;
    cleanupStarted.clear();
  },
};
