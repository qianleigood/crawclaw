import path from "node:path";
import { resolveStateDir } from "../../config/paths.ts";
import { normalizeAgentId } from "../../routing/session-key.ts";
import { validateSessionId } from "../../config/sessions/paths.ts";

export function resolveSessionSummaryRootDir(): string {
  return path.join(resolveStateDir(), "session-summary");
}

export function resolveSessionSummaryDir(params: {
  agentId?: string | null;
  sessionId?: string | null;
  rootDir?: string | null;
}): string {
  const agentId = normalizeAgentId(params.agentId ?? undefined);
  const sessionId = validateSessionId(params.sessionId ?? "session");
  const rootDir = params.rootDir?.trim() ? path.resolve(params.rootDir.trim()) : resolveSessionSummaryRootDir();
  return path.join(rootDir, "agents", agentId, "sessions", sessionId);
}

export function resolveSessionSummaryPath(params: {
  agentId?: string | null;
  sessionId?: string | null;
  rootDir?: string | null;
}): string {
  return path.join(resolveSessionSummaryDir(params), "summary.md");
}
