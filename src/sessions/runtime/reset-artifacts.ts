import { disposeSessionMcpRuntime } from "../../agents/pi-bundle-mcp-tools.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { archiveSessionTranscripts as archiveSessionTranscriptFiles } from "../transcript-archive.fs.js";

const log = createSubsystemLogger("session-reset-artifacts");

export function archiveSessionTranscriptsForMutation(params: {
  sessionId: string | undefined;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
  reason: "reset" | "deleted";
}): string[] {
  if (!params.sessionId) {
    return [];
  }
  return archiveSessionTranscriptFiles({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
    agentId: params.agentId,
    reason: params.reason,
  });
}

export async function archivePreviousSessionArtifacts(params: {
  sessionId: string | undefined;
  storePath: string | undefined;
  sessionFile?: string;
  agentId?: string;
  disposeMcpRuntime?: boolean;
}): Promise<string[]> {
  const archived = archiveSessionTranscriptsForMutation({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
    agentId: params.agentId,
    reason: "reset",
  });
  if (params.disposeMcpRuntime && params.sessionId) {
    await disposeSessionMcpRuntime(params.sessionId).catch((error) => {
      log.warn(`failed to dispose bundle MCP runtime for session ${params.sessionId}`, {
        error: String(error),
      });
    });
  }
  return archived;
}
