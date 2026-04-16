import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { type SessionEntry, updateSessionStore } from "../config/sessions.js";
import { ensureSessionTranscriptHeader } from "../config/sessions/transcript.js";
import { logVerbose } from "../globals.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { createPluginRuntime } from "../plugins/runtime/index.js";
import { isSubagentSessionKey, normalizeAgentId } from "../routing/session-key.js";
import { emitBeforeResetPluginHook } from "../sessions/runtime/before-reset-hook.js";
import { archiveSessionTranscriptsForMutation } from "../sessions/runtime/reset-artifacts.js";
import { cleanupSessionBeforeMutation } from "../sessions/runtime/reset-cleanup.js";
import { emitResetInternalHook } from "../sessions/runtime/reset-internal-hook.js";
import { errorShape } from "./protocol/index.js";
import { buildGatewayResetEntry } from "./session-reset-entry.js";
import {
  loadSessionEntry,
  migrateAndPruneGatewaySessionStoreKey,
  readSessionMessages,
  resolveGatewaySessionStoreTarget,
} from "./session-utils.js";

let cachedChannelRuntime: ReturnType<typeof createPluginRuntime>["channel"] | undefined;

function getChannelRuntime() {
  cachedChannelRuntime ??= createPluginRuntime().channel;
  return cachedChannelRuntime;
}

export async function emitSessionUnboundLifecycleEvent(params: {
  targetSessionKey: string;
  reason: "session-reset" | "session-delete";
  emitHooks?: boolean;
}) {
  const targetKind = isSubagentSessionKey(params.targetSessionKey) ? "subagent" : "acp";
  const channelRuntime = getChannelRuntime();
  channelRuntime.discord.threadBindings.unbindBySessionKey({
    targetSessionKey: params.targetSessionKey,
    targetKind,
    reason: params.reason,
    sendFarewell: true,
  });

  if (params.emitHooks === false) {
    return;
  }

  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("subagent_ended")) {
    return;
  }
  await hookRunner.runSubagentEnded(
    {
      targetSessionKey: params.targetSessionKey,
      targetKind,
      reason: params.reason,
      sendFarewell: true,
      outcome: params.reason === "session-reset" ? "reset" : "deleted",
    },
    {
      childSessionKey: params.targetSessionKey,
    },
  );
}

export { cleanupSessionBeforeMutation };

function emitGatewayBeforeResetPluginHook(params: {
  cfg: ReturnType<typeof loadConfig>;
  key: string;
  target: ReturnType<typeof resolveGatewaySessionStoreTarget>;
  storePath: string;
  entry?: SessionEntry;
  reason: "new" | "reset";
}): void {
  const hookRunner = getGlobalHookRunner();
  const sessionKey = params.target.canonicalKey ?? params.key;
  const sessionId = params.entry?.sessionId;
  const sessionFile = params.entry?.sessionFile;
  const agentId = normalizeAgentId(params.target.agentId ?? resolveDefaultAgentId(params.cfg));
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
  emitBeforeResetPluginHook({
    hookRunner: hookRunner ?? undefined,
    loadMessages: async () => {
      let messages: unknown[] = [];
      try {
        if (typeof sessionId === "string" && sessionId.trim().length > 0) {
          messages = readSessionMessages(sessionId, params.storePath, sessionFile);
        }
      } catch (err) {
        logVerbose(
          `before_reset: failed to read session messages for ${sessionId ?? "(none)"}; firing hook with empty messages (${String(err)})`,
        );
      }
      return { sessionFile, messages };
    },
    reason: params.reason,
    agentId,
    sessionKey,
    sessionId,
    workspaceDir,
  });
}

export async function performGatewaySessionReset(params: {
  key: string;
  reason: "new" | "reset";
  commandSource: string;
}): Promise<
  | { ok: true; key: string; entry: SessionEntry }
  | { ok: false; error: ReturnType<typeof errorShape> }
> {
  const { cfg, target, storePath } = (() => {
    const cfg = loadConfig();
    const target = resolveGatewaySessionStoreTarget({ cfg, key: params.key });
    return { cfg, target, storePath: target.storePath };
  })();
  const { entry, legacyKey, canonicalKey } = loadSessionEntry(params.key);
  const hadExistingEntry = Boolean(entry);
  await emitResetInternalHook({
    action: params.reason,
    sessionKey: target.canonicalKey ?? params.key,
    sessionEntry: entry,
    previousSessionEntry: entry,
    commandSource: params.commandSource,
    cfg,
  });
  const mutationCleanupError = await cleanupSessionBeforeMutation({
    cfg,
    key: params.key,
    target,
    entry,
    legacyKey,
    canonicalKey,
    reason: "session-reset",
  });
  if (mutationCleanupError) {
    return { ok: false, error: mutationCleanupError };
  }

  let oldSessionId: string | undefined;
  let oldSessionFile: string | undefined;
  let resetSourceEntry: SessionEntry | undefined;
  const next = await updateSessionStore(storePath, (store) => {
    const { primaryKey } = migrateAndPruneGatewaySessionStoreKey({
      cfg,
      key: params.key,
      store,
    });
    const built = buildGatewayResetEntry({
      cfg,
      primaryKey,
      currentEntry: store[primaryKey],
      storePath,
    });
    resetSourceEntry = built.resetSourceEntry;
    oldSessionId = built.oldSessionId;
    oldSessionFile = built.oldSessionFile;
    const nextEntry = built.nextEntry;
    store[primaryKey] = nextEntry;
    return nextEntry;
  });
  emitGatewayBeforeResetPluginHook({
    cfg,
    key: params.key,
    target,
    storePath,
    entry: resetSourceEntry,
    reason: params.reason,
  });

  archiveSessionTranscriptsForMutation({
    sessionId: oldSessionId,
    storePath,
    sessionFile: oldSessionFile,
    agentId: target.agentId,
    reason: "reset",
  });
  await ensureSessionTranscriptHeader({
    sessionFile: next.sessionFile as string,
    sessionId: next.sessionId,
  });
  if (hadExistingEntry) {
    await emitSessionUnboundLifecycleEvent({
      targetSessionKey: target.canonicalKey ?? params.key,
      reason: "session-reset",
    });
  }
  return { ok: true, key: target.canonicalKey, entry: next };
}
