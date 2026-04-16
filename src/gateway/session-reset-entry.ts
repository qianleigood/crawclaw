import { randomUUID } from "node:crypto";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { CrawClawConfig } from "../config/config.js";
import { snapshotSessionOrigin, type SessionEntry } from "../config/sessions.js";
import { resolveSessionFilePath, resolveSessionFilePathOptions } from "../config/sessions/paths.js";
import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";
import { pickResetCarryOverFields } from "../sessions/runtime/reset-carry-over.js";
import { resolveSessionModelRef } from "./session-utils.js";

function stripRuntimeModelState(entry?: SessionEntry): SessionEntry | undefined {
  if (!entry) {
    return entry;
  }
  return {
    ...entry,
    model: undefined,
    modelProvider: undefined,
    contextTokens: undefined,
    systemPromptReport: undefined,
  };
}

export function buildGatewayResetEntry(params: {
  cfg: CrawClawConfig;
  primaryKey: string;
  currentEntry?: SessionEntry;
  storePath: string;
  now?: number;
  createSessionId?: () => string;
}): {
  nextEntry: SessionEntry;
  resetSourceEntry?: SessionEntry;
  oldSessionId?: string;
  oldSessionFile?: string;
} {
  const currentEntry = params.currentEntry;
  const resetSourceEntry = currentEntry ? { ...currentEntry } : undefined;
  const resetEntry = stripRuntimeModelState(currentEntry);
  const parsed = parseAgentSessionKey(params.primaryKey);
  const sessionAgentId = normalizeAgentId(parsed?.agentId ?? resolveDefaultAgentId(params.cfg));
  const resolvedModel = resolveSessionModelRef(params.cfg, resetEntry, sessionAgentId);
  const nextSessionId = params.createSessionId ? params.createSessionId() : randomUUID();
  const sessionFile = resolveSessionFilePath(
    nextSessionId,
    currentEntry?.sessionFile ? { sessionFile: currentEntry.sessionFile } : undefined,
    resolveSessionFilePathOptions({
      storePath: params.storePath,
      agentId: sessionAgentId,
    }),
  );
  const carryOver = pickResetCarryOverFields(currentEntry, "gateway-reset");
  const nextEntry: SessionEntry = {
    ...carryOver,
    sessionId: nextSessionId,
    sessionFile,
    updatedAt: params.now ?? Date.now(),
    systemSent: false,
    abortedLastRun: false,
    model: resolvedModel.model,
    modelProvider: resolvedModel.provider,
    contextTokens: resetEntry?.contextTokens,
    origin: snapshotSessionOrigin(currentEntry),
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalTokensFresh: true,
  };
  return {
    nextEntry,
    resetSourceEntry,
    oldSessionId: currentEntry?.sessionId,
    oldSessionFile: currentEntry?.sessionFile,
  };
}
