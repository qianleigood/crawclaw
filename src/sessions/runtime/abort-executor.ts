import type { CrawClawConfig } from "../../config/config.js";
import { updateSessionStore, type SessionEntry } from "../../config/sessions.js";
import { callGateway } from "../../gateway/call.js";
import { logVerbose } from "../../globals.js";

export type AbortCutoff = {
  messageSid?: string;
  timestamp?: number;
};

export type ClearSessionQueueResult = {
  followupCleared: number;
  laneCleared: number;
  keys: string[];
};

function applyAbortCutoffToSessionEntry(
  entry: Pick<SessionEntry, "abortCutoffMessageSid" | "abortCutoffTimestamp">,
  cutoff: AbortCutoff | undefined,
): void {
  entry.abortCutoffMessageSid = cutoff?.messageSid;
  entry.abortCutoffTimestamp = cutoff?.timestamp;
}

async function persistAbortTargetEntry(params: {
  entry?: SessionEntry;
  key?: string;
  legacyKeys?: string[];
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  abortCutoff?: AbortCutoff;
}): Promise<boolean> {
  const { entry, key, legacyKeys, sessionStore, storePath, abortCutoff } = params;
  if (!entry || !key || !sessionStore) {
    return false;
  }

  entry.abortedLastRun = true;
  applyAbortCutoffToSessionEntry(entry, abortCutoff);
  entry.updatedAt = Date.now();
  sessionStore[key] = entry;
  for (const legacyKey of legacyKeys ?? []) {
    if (legacyKey !== key) {
      delete sessionStore[legacyKey];
    }
  }

  if (storePath) {
    await updateSessionStore(storePath, (store) => {
      const nextEntry = store[key] ?? entry;
      nextEntry.abortedLastRun = true;
      applyAbortCutoffToSessionEntry(nextEntry, abortCutoff);
      nextEntry.updatedAt = Date.now();
      store[key] = nextEntry;
      for (const legacyKey of legacyKeys ?? []) {
        if (legacyKey !== key) {
          delete store[legacyKey];
        }
      }
    });
  }

  return true;
}

async function cancelAcpSessionIfPresent(params: {
  cfg?: CrawClawConfig;
  sessionKey?: string;
  reason?: string;
}): Promise<void> {
  if (!params.cfg || !params.sessionKey) {
    return;
  }
  try {
    await callGateway({
      method: "acp.session.cancel",
      params: {
        sessionKey: params.sessionKey,
        reason: params.reason,
      },
      timeoutMs: 10_000,
    });
  } catch (error) {
    logVerbose(
      `abort: ACP cancel failed for ${params.sessionKey}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function executeAbortTarget(params: {
  entry?: SessionEntry;
  key?: string;
  legacyKeys?: string[];
  sessionId?: string;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  abortKey?: string;
  abortCutoff?: AbortCutoff;
  queueKeys?: Array<string | undefined>;
  cfg?: CrawClawConfig;
  sessionKey?: string;
  acpCancelReason?: string;
}): Promise<{
  aborted: boolean;
  persisted: boolean;
  cleared: ClearSessionQueueResult;
}> {
  await cancelAcpSessionIfPresent({
    cfg: params.cfg,
    sessionKey: params.sessionKey ?? params.key,
    reason: params.acpCancelReason,
  });
  const queueKeys = (params.queueKeys ?? []).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const cleared: ClearSessionQueueResult = {
    followupCleared: 0,
    laneCleared: 0,
    keys: queueKeys,
  };
  const aborted = false;
  const persisted = await persistAbortTargetEntry({
    entry: params.entry,
    key: params.key,
    legacyKeys: params.legacyKeys,
    sessionStore: params.sessionStore,
    storePath: params.storePath,
    abortCutoff: params.abortCutoff,
  });
  return { aborted, persisted, cleared };
}
