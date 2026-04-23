import type { CrawClawConfig } from "../../../../config/config.js";
import { emitSessionTranscriptUpdate } from "../../../../sessions/transcript-events.js";

export async function runPostCompactionSideEffects(params: {
  config?: CrawClawConfig;
  sessionKey?: string;
  sessionFile: string;
}): Promise<void> {
  const sessionFile = params.sessionFile.trim();
  if (!sessionFile) {
    return;
  }
  emitSessionTranscriptUpdate(sessionFile);
}
