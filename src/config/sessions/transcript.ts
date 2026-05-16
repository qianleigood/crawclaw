import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { emitSessionTranscriptUpdate } from "../../sessions/transcript-events.js";
import {
  resolveDefaultSessionStorePath,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  resolveSessionTranscriptPath,
} from "./paths.js";
import { resolveAndPersistSessionFile } from "./session-file.js";
import { loadSessionStore, normalizeStoreSessionKey } from "./store.js";
import { parseSessionThreadInfo } from "./thread-info.js";
import type { SessionEntry } from "./types.js";

export const SESSION_TRANSCRIPT_VERSION = 1;

export type SessionTranscriptMessage = {
  role: string;
  content: unknown;
  timestamp?: number;
  [key: string]: unknown;
};

function stripQuery(value: string): string {
  const noHash = value.split("#")[0] ?? value;
  return noHash.split("?")[0] ?? noHash;
}

function extractFileNameFromMediaUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const cleaned = stripQuery(trimmed);
  try {
    const parsed = new URL(cleaned);
    const base = path.basename(parsed.pathname);
    if (!base) {
      return null;
    }
    try {
      return decodeURIComponent(base);
    } catch {
      return base;
    }
  } catch {
    const base = path.basename(cleaned);
    if (!base || base === "/" || base === ".") {
      return null;
    }
    return base;
  }
}

export function resolveMirroredTranscriptText(params: {
  text?: string;
  mediaUrls?: string[];
}): string | null {
  const mediaUrls = params.mediaUrls?.filter((url) => url && url.trim()) ?? [];
  if (mediaUrls.length > 0) {
    const names = mediaUrls
      .map((url) => extractFileNameFromMediaUrl(url))
      .filter((name): name is string => Boolean(name && name.trim()));
    if (names.length > 0) {
      return names.join(", ");
    }
    return "media";
  }

  const text = params.text ?? "";
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}

export async function ensureSessionTranscriptHeader(params: {
  sessionFile: string;
  sessionId: string;
}): Promise<void> {
  if (fs.existsSync(params.sessionFile)) {
    return;
  }
  await fs.promises.mkdir(path.dirname(params.sessionFile), { recursive: true });
  const header = {
    type: "session",
    version: SESSION_TRANSCRIPT_VERSION,
    id: params.sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  };
  await fs.promises.writeFile(params.sessionFile, `${JSON.stringify(header)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export async function resolveSessionTranscriptFile(params: {
  sessionId: string;
  sessionKey: string;
  sessionEntry: SessionEntry | undefined;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  agentId: string;
  threadId?: string | number;
}): Promise<{ sessionFile: string; sessionEntry: SessionEntry | undefined }> {
  const sessionPathOpts = resolveSessionFilePathOptions({
    agentId: params.agentId,
    storePath: params.storePath,
  });
  let sessionFile = resolveSessionFilePath(params.sessionId, params.sessionEntry, sessionPathOpts);
  let sessionEntry = params.sessionEntry;

  if (params.sessionStore && params.storePath) {
    const threadIdFromSessionKey =
      parseSessionThreadInfo(params.sessionKey).threadId ??
      inferTerminalTopicIdFromSessionKey(params.sessionKey);
    const fallbackSessionFile = !sessionEntry?.sessionFile
      ? resolveSessionTranscriptPath(
          params.sessionId,
          params.agentId,
          params.threadId ?? threadIdFromSessionKey,
        )
      : undefined;
    const resolvedSessionFile = await resolveAndPersistSessionFile({
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      sessionStore: params.sessionStore,
      storePath: params.storePath,
      sessionEntry,
      agentId: sessionPathOpts?.agentId,
      sessionsDir: sessionPathOpts?.sessionsDir,
      fallbackSessionFile,
    });
    sessionFile = resolvedSessionFile.sessionFile;
    sessionEntry = resolvedSessionFile.sessionEntry;
  }

  return {
    sessionFile,
    sessionEntry,
  };
}

export async function appendMessageToSessionTranscriptFile(params: {
  sessionFile: string;
  sessionKey?: string;
  message: SessionTranscriptMessage;
}): Promise<{ messageId: string; record: Record<string, unknown> }> {
  const messageId = randomUUID();
  const parentId = await readLastTranscriptMessageId(params.sessionFile);
  const record = {
    type: "message",
    id: messageId,
    parentId,
    message: params.message,
  };
  await fs.promises.mkdir(path.dirname(params.sessionFile), { recursive: true });
  await fs.promises.appendFile(params.sessionFile, `${JSON.stringify(record)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  emitSessionTranscriptUpdate({
    sessionFile: params.sessionFile,
    sessionKey: params.sessionKey,
    message: params.message,
    messageId,
  });
  return { messageId, record };
}

async function readLastTranscriptMessageId(sessionFile: string): Promise<string | null> {
  try {
    const raw = await fs.promises.readFile(sessionFile, "utf-8");
    for (const line of raw.split(/\r?\n/).filter(Boolean).toReversed()) {
      try {
        const parsed = JSON.parse(line) as { type?: unknown; id?: unknown };
        if (parsed.type === "message" && typeof parsed.id === "string" && parsed.id) {
          return parsed.id;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function inferTerminalTopicIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  const trimmed = sessionKey?.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /:topic:([^:]+)$/i.exec(trimmed);
  return match?.[1]?.trim() || undefined;
}

export async function appendAssistantMessageToSessionTranscript(params: {
  agentId?: string;
  sessionKey: string;
  text?: string;
  mediaUrls?: string[];
  idempotencyKey?: string;
  /** Optional override for store path (mostly for tests). */
  storePath?: string;
}): Promise<{ ok: true; sessionFile: string; messageId: string } | { ok: false; reason: string }> {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return { ok: false, reason: "missing sessionKey" };
  }

  const mirrorText = resolveMirroredTranscriptText({
    text: params.text,
    mediaUrls: params.mediaUrls,
  });
  if (!mirrorText) {
    return { ok: false, reason: "empty text" };
  }

  const storePath = params.storePath ?? resolveDefaultSessionStorePath(params.agentId);
  const store = loadSessionStore(storePath, { skipCache: true });
  const normalizedKey = normalizeStoreSessionKey(sessionKey);
  const entry = (store[normalizedKey] ?? store[sessionKey]) as SessionEntry | undefined;
  if (!entry?.sessionId) {
    return { ok: false, reason: `unknown sessionKey: ${sessionKey}` };
  }

  let sessionFile: string;
  try {
    const resolvedSessionFile = await resolveAndPersistSessionFile({
      sessionId: entry.sessionId,
      sessionKey,
      sessionStore: store,
      storePath,
      sessionEntry: entry,
      agentId: params.agentId,
      sessionsDir: path.dirname(storePath),
    });
    sessionFile = resolvedSessionFile.sessionFile;
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  await ensureSessionTranscriptHeader({ sessionFile, sessionId: entry.sessionId });

  const existingMessageId = params.idempotencyKey
    ? await transcriptHasIdempotencyKey(sessionFile, params.idempotencyKey)
    : undefined;
  if (existingMessageId) {
    return { ok: true, sessionFile, messageId: existingMessageId };
  }

  const message = {
    role: "assistant" as const,
    content: [{ type: "text", text: mirrorText }],
    api: "openai-responses",
    provider: "crawclaw",
    model: "delivery-mirror",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
  };
  const { messageId } = await appendMessageToSessionTranscriptFile({
    sessionFile,
    sessionKey,
    message,
  });
  return { ok: true, sessionFile, messageId };
}

async function transcriptHasIdempotencyKey(
  transcriptPath: string,
  idempotencyKey: string,
): Promise<string | undefined> {
  try {
    const raw = await fs.promises.readFile(transcriptPath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as {
          id?: unknown;
          message?: { id?: unknown; idempotencyKey?: unknown };
        };
        if (parsed.message?.idempotencyKey === idempotencyKey) {
          if (typeof parsed.id === "string" && parsed.id) {
            return parsed.id;
          }
          if (typeof parsed.message.id === "string" && parsed.message.id) {
            return parsed.message.id;
          }
          return idempotencyKey;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
