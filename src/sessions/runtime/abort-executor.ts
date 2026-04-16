import { getAcpSessionManager } from "../../acp/control-plane/manager.js";
import { abortEmbeddedPiRun } from "../../agents/pi-embedded.js";
import type { AbortCutoff } from "../../auto-reply/reply/abort-cutoff.js";
import { setAbortMemory } from "../../auto-reply/reply/abort-primitives.js";
import { persistAbortTargetEntry } from "../../auto-reply/reply/commands-session-store.js";
import { clearSessionQueues } from "../../auto-reply/reply/queue.js";
import type { CrawClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";

async function cancelAcpSessionIfPresent(params: {
  cfg?: CrawClawConfig;
  sessionKey?: string;
  reason?: string;
}): Promise<void> {
  if (!params.cfg || !params.sessionKey) {
    return;
  }
  const acpManager = getAcpSessionManager();
  const acpResolution = acpManager.resolveSession({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
  });
  if (acpResolution.kind === "none") {
    return;
  }
  try {
    await acpManager.cancelSession({
      cfg: params.cfg,
      sessionKey: params.sessionKey,
      reason: params.reason,
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
  cleared: ReturnType<typeof clearSessionQueues>;
}> {
  await cancelAcpSessionIfPresent({
    cfg: params.cfg,
    sessionKey: params.sessionKey ?? params.key,
    reason: params.acpCancelReason,
  });
  const queueKeys = (params.queueKeys ?? []).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  const cleared = clearSessionQueues(queueKeys);
  const aborted = params.sessionId ? abortEmbeddedPiRun(params.sessionId) : false;
  const persisted = await persistAbortTargetEntry({
    entry: params.entry,
    key: params.key,
    legacyKeys: params.legacyKeys,
    sessionStore: params.sessionStore,
    storePath: params.storePath,
    abortCutoff: params.abortCutoff,
  });
  if (!persisted && params.abortKey) {
    setAbortMemory(params.abortKey, true);
  }
  return { aborted, persisted, cleared };
}
