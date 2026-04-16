import type { SessionEntry } from "../../config/sessions.js";
import { updateSessionStore } from "../../config/sessions.js";
import type { ErrorShape, SessionsPatchParams } from "../../gateway/protocol/index.js";
import { applySessionsPatchToStore } from "../../gateway/sessions-patch.js";
import { applyAbortCutoffToSessionEntry, type AbortCutoff } from "./abort-cutoff.js";
import type { CommandHandler } from "./commands-types.js";

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
  const { commandParams, patch } = params;
  if (!commandParams.sessionEntry || !commandParams.sessionStore || !commandParams.sessionKey) {
    return { ok: true, entry: commandParams.sessionEntry };
  }

  const fullPatch: SessionsPatchParams = {
    key: commandParams.sessionKey,
    ...patch,
  };
  const applied = await applySessionsPatchToStore({
    cfg: commandParams.cfg,
    store: commandParams.sessionStore,
    storeKey: commandParams.sessionKey,
    patch: fullPatch,
  });
  if (!applied.ok) {
    return applied;
  }

  commandParams.sessionEntry = applied.entry;
  commandParams.sessionStore[commandParams.sessionKey] = applied.entry;

  if (commandParams.storePath) {
    const persistedEntry = await updateSessionStore(commandParams.storePath, async (store) => {
      const persisted = await applySessionsPatchToStore({
        cfg: commandParams.cfg,
        store,
        storeKey: commandParams.sessionKey,
        patch: fullPatch,
      });
      if (!persisted.ok) {
        throw new Error(`session patch persistence failed: ${persisted.error.message}`);
      }
      return persisted.entry;
    });
    commandParams.sessionEntry = persistedEntry;
    commandParams.sessionStore[commandParams.sessionKey] = persistedEntry;
    return { ok: true, entry: persistedEntry };
  }

  return { ok: true, entry: applied.entry };
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
