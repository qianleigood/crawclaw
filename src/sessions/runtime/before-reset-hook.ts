import fs from "node:fs/promises";
import path from "node:path";
import { logVerbose } from "../../globals.js";
import type { HookRunner } from "../../plugins/hooks.js";

type BeforeResetHookRunner = Pick<HookRunner, "hasHooks" | "runBeforeReset">;

// Reset hooks only need the transcript message payloads, not session headers or metadata rows.
function parseTranscriptMessages(content: string): unknown[] {
  const messages: unknown[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      if (entry.type === "message" && entry.message) {
        messages.push(entry.message);
      }
    } catch {
      // Skip malformed lines from partially-written transcripts.
    }
  }
  return messages;
}

// Once /new rotates a transcript, the newest archived sibling is the best fallback source.
async function findLatestArchivedTranscript(sessionFile: string): Promise<string | undefined> {
  try {
    const dir = path.dirname(sessionFile);
    const base = path.basename(sessionFile);
    const resetPrefix = `${base}.reset.`;
    const archived = (await fs.readdir(dir))
      .filter((name) => name.startsWith(resetPrefix))
      .toSorted();
    const latest = archived[archived.length - 1];
    return latest ? path.join(dir, latest) : undefined;
  } catch {
    return undefined;
  }
}

// Prefer the live transcript path, but fall back to the archived reset transcript when rotation won the race.
export async function loadBeforeResetTranscript(params: {
  sessionFile?: string;
}): Promise<{ sessionFile?: string; messages: unknown[] }> {
  const sessionFile = params.sessionFile;
  if (!sessionFile) {
    logVerbose("before_reset: no session file available, firing hook with empty messages");
    return { sessionFile, messages: [] };
  }

  try {
    return {
      sessionFile,
      messages: parseTranscriptMessages(await fs.readFile(sessionFile, "utf-8")),
    };
  } catch (err: unknown) {
    if ((err as { code?: unknown })?.code !== "ENOENT") {
      logVerbose(
        `before_reset: failed to read session file ${sessionFile}; firing hook with empty messages (${String(err)})`,
      );
      return { sessionFile, messages: [] };
    }
  }

  const archivedSessionFile = await findLatestArchivedTranscript(sessionFile);
  if (!archivedSessionFile) {
    logVerbose(
      `before_reset: failed to find archived transcript for ${sessionFile}; firing hook with empty messages`,
    );
    return { sessionFile, messages: [] };
  }

  try {
    return {
      sessionFile: archivedSessionFile,
      messages: parseTranscriptMessages(await fs.readFile(archivedSessionFile, "utf-8")),
    };
  } catch (err: unknown) {
    logVerbose(
      `before_reset: failed to read archived session file ${archivedSessionFile}; firing hook with empty messages (${String(err)})`,
    );
    return { sessionFile: archivedSessionFile, messages: [] };
  }
}

export function emitBeforeResetPluginHook(params: {
  hookRunner: BeforeResetHookRunner | undefined;
  loadMessages: () => Promise<{ sessionFile?: string; messages: unknown[] }>;
  reason: "new" | "reset";
  agentId: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir: string;
}): void {
  const hookRunner = params.hookRunner;
  if (!hookRunner?.hasHooks("before_reset")) {
    return;
  }

  void (async () => {
    const { sessionFile, messages } = await params.loadMessages();

    try {
      await hookRunner.runBeforeReset(
        { sessionFile, messages, reason: params.reason },
        {
          agentId: params.agentId,
          sessionKey: params.sessionKey,
          sessionId: params.sessionId,
          workspaceDir: params.workspaceDir,
        },
      );
    } catch (err: unknown) {
      logVerbose(`before_reset hook failed: ${String(err)}`);
    }
  })();
}
