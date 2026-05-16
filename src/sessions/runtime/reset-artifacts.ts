import { archiveSessionTranscripts as archiveSessionTranscriptFiles } from "../transcript-archive.fs.js";

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
  void params.disposeMcpRuntime;
  return archived;
}
