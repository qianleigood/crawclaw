import type { SessionEntry } from "../../config/sessions.js";
import { updateSessionStore } from "../../config/sessions.js";
import type { ErrorShape, SessionsPatchParams } from "../../gateway/protocol/index.js";
import { applyAbortCutoffToSessionEntry, type AbortCutoff } from "./abort-cutoff.js";
import type { CommandHandler } from "./commands-types.js";
import { applySharedSessionPatch } from "./session-patch-runtime.js";

type CommandParams = Parameters<CommandHandler>[0];
type CommandSessionPatch = Omit<SessionsPatchParams, "key">;

export async function persistSessionEntry(params: CommandParams): Promise<boolean> {
  if (!params.sessionEntry || !params.sessionStore || !params.sessionKey) {
    return false;
  }
  params.sessionEntry.updatedAt = Date.now();
  params.sessionStore[params.sessionKey] = params.sessionEntry;
  if (params.storePath) {
    await updateSessionStore(params.storePath, (store) => {
      store[params.sessionKey] = params.sessionEntry as SessionEntry;
    });
  }
  return true;
}

export async function applyCommandSessionPatch(params: {
  commandParams: CommandParams;
  patch: CommandSessionPatch;
}): Promise<{ ok: true; entry?: SessionEntry } | { ok: false; error: ErrorShape }> {
  const { commandParams } = params;
  const applied = await applySharedSessionPatch({
    cfg: commandParams.cfg,
    sessionEntry: commandParams.sessionEntry,
    sessionStore: commandParams.sessionStore,
    sessionKey: commandParams.sessionKey,
    storePath: commandParams.storePath,
    patch: params.patch,
  });
  if (applied.ok) {
    commandParams.sessionEntry = applied.entry;
  }
  return applied;
}

export async function persistAbortTargetEntry(params: {
  entry?: SessionEntry;
  key?: string;
  sessionStore?: Record<string, SessionEntry>;
  storePath?: string;
  abortCutoff?: AbortCutoff;
}): Promise<boolean> {
  const { entry, key, sessionStore, storePath, abortCutoff } = params;
  if (!entry || !key || !sessionStore) {
    return false;
  }

  entry.abortedLastRun = true;
  applyAbortCutoffToSessionEntry(entry, abortCutoff);
  entry.updatedAt = Date.now();
  sessionStore[key] = entry;

  if (storePath) {
    await updateSessionStore(storePath, (store) => {
      const nextEntry = store[key] ?? entry;
      if (!nextEntry) {
        return;
      }
      nextEntry.abortedLastRun = true;
      applyAbortCutoffToSessionEntry(nextEntry, abortCutoff);
      nextEntry.updatedAt = Date.now();
      store[key] = nextEntry;
    });
  }

  return true;
}
