import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveSessionFilePath } from "../../config/sessions/paths.js";
import { SESSION_TRANSCRIPT_VERSION } from "../../config/sessions/transcript.js";
import type { SessionEntry } from "../../config/sessions/types.js";

export function forkSessionFromParentRuntime(params: {
  parentEntry: SessionEntry;
  agentId: string;
  sessionsDir: string;
}): { sessionId: string; sessionFile: string } | null {
  const parentSessionFile = resolveSessionFilePath(
    params.parentEntry.sessionId,
    params.parentEntry,
    { agentId: params.agentId, sessionsDir: params.sessionsDir },
  );
  if (!parentSessionFile || !fs.existsSync(parentSessionFile)) {
    return null;
  }
  try {
    const parentHeader = readSessionHeader(parentSessionFile);
    const sessionId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const fileTimestamp = timestamp.replace(/[:.]/g, "-");
    const sessionFile = path.join(params.sessionsDir, `${fileTimestamp}_${sessionId}.jsonl`);
    const header = {
      type: "session",
      version: SESSION_TRANSCRIPT_VERSION,
      id: sessionId,
      timestamp,
      cwd: typeof parentHeader?.cwd === "string" ? parentHeader.cwd : process.cwd(),
      parentSession: parentSessionFile,
    };
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
    return { sessionId, sessionFile };
  } catch {
    return null;
  }
}

function readSessionHeader(sessionFile: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(sessionFile, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      const parsed = JSON.parse(line) as Record<string, unknown>;
      return parsed.type === "session" ? parsed : null;
    }
  } catch {
    return null;
  }
  return null;
}
