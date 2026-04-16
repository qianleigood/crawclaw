import type { CrawClawConfig } from "../../config/config.js";
import { updateSessionStore } from "../../config/sessions/store.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import { deliverSessionMaintenanceWarning } from "../../infra/session-maintenance-warning.js";
import { archivePreviousSessionArtifacts } from "../../sessions/runtime/reset-artifacts.js";

export async function finalizeSessionInitState(params: {
  cfg: CrawClawConfig;
  sessionStore: Record<string, SessionEntry>;
  sessionKey: string;
  sessionEntry: SessionEntry;
  storePath: string;
  retiredLegacyMainDelivery?: { key: string; entry: SessionEntry };
  previousSessionEntry?: SessionEntry;
  agentId: string;
  isNewSession: boolean;
}): Promise<SessionEntry> {
  const sessionEntry = params.sessionEntry;
  if (params.isNewSession) {
    sessionEntry.compactionCount = 0;
    sessionEntry.memoryFlushCompactionCount = undefined;
    sessionEntry.memoryFlushAt = undefined;
    sessionEntry.memoryFlushContextHash = undefined;
    sessionEntry.totalTokens = undefined;
    sessionEntry.inputTokens = undefined;
    sessionEntry.outputTokens = undefined;
    sessionEntry.estimatedCostUsd = undefined;
    sessionEntry.contextTokens = undefined;
  }

  params.sessionStore[params.sessionKey] = {
    ...params.sessionStore[params.sessionKey],
    ...sessionEntry,
  };
  await updateSessionStore(
    params.storePath,
    (store) => {
      store[params.sessionKey] = {
        ...store[params.sessionKey],
        ...sessionEntry,
      };
      if (params.retiredLegacyMainDelivery) {
        store[params.retiredLegacyMainDelivery.key] = params.retiredLegacyMainDelivery.entry;
      }
    },
    {
      activeSessionKey: params.sessionKey,
      onWarn: (warning) =>
        deliverSessionMaintenanceWarning({
          cfg: params.cfg,
          sessionKey: params.sessionKey,
          entry: sessionEntry,
          warning,
        }),
    },
  );

  if (params.previousSessionEntry?.sessionId) {
    await archivePreviousSessionArtifacts({
      sessionId: params.previousSessionEntry.sessionId,
      storePath: params.storePath,
      sessionFile: params.previousSessionEntry.sessionFile,
      agentId: params.agentId,
      disposeMcpRuntime: true,
    });
  }

  return sessionEntry;
}
