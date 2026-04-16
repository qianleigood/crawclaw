import type { ModelCatalogEntry } from "../../agents/model-catalog.js";
import type { CrawClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { updateSessionStore } from "../../config/sessions.js";
import type { ErrorShape, SessionsPatchParams } from "../../gateway/protocol/index.js";
import { applySessionsPatchToStore } from "../../gateway/sessions-patch.js";
import {
  applyModelOverrideToSessionEntry,
  type ModelOverrideSelection,
} from "../../sessions/model-overrides.js";

export type SharedSessionPatch = Omit<SessionsPatchParams, "key">;

function replaceSessionEntryContents(target: SessionEntry, source: SessionEntry): void {
  for (const key of Object.keys(target)) {
    if (!(key in source)) {
      delete (target as Record<string, unknown>)[key];
    }
  }
  Object.assign(target, source);
}

async function persistMutatedSessionEntry(params: {
  sessionEntry: SessionEntry;
  sessionStore: Record<string, SessionEntry>;
  sessionKey: string;
  storePath?: string;
  apply: (entry: SessionEntry) => { updated: boolean };
}): Promise<{ updated: boolean; entry: SessionEntry }> {
  const applied = params.apply(params.sessionEntry);
  if (!applied.updated) {
    return { updated: false, entry: params.sessionEntry };
  }

  params.sessionStore[params.sessionKey] = params.sessionEntry;
  if (!params.storePath) {
    return { updated: true, entry: params.sessionEntry };
  }

  const persisted = await updateSessionStore(params.storePath, (store) => {
    const entry = store[params.sessionKey] ?? { ...params.sessionEntry };
    params.apply(entry);
    store[params.sessionKey] = entry;
    return entry;
  });
  const finalEntry = persisted ?? params.sessionEntry;
  replaceSessionEntryContents(params.sessionEntry, finalEntry);
  params.sessionStore[params.sessionKey] = params.sessionEntry;
  return { updated: true, entry: params.sessionEntry };
}

export async function applySharedSessionPatch(params: {
  cfg: CrawClawConfig;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  patch: SharedSessionPatch;
  loadModelCatalog?: () => Promise<ModelCatalogEntry[]>;
}): Promise<{ ok: true; entry?: SessionEntry } | { ok: false; error: ErrorShape }> {
  const { sessionEntry, sessionStore, sessionKey } = params;
  if (!sessionEntry || !sessionStore || !sessionKey) {
    return { ok: true, entry: sessionEntry };
  }

  const fullPatch: SessionsPatchParams = {
    key: sessionKey,
    ...params.patch,
  };

  const applyPatch = async (store: Record<string, SessionEntry>) =>
    await applySessionsPatchToStore({
      cfg: params.cfg,
      store,
      storeKey: sessionKey,
      patch: fullPatch,
      ...(params.loadModelCatalog ? { loadGatewayModelCatalog: params.loadModelCatalog } : {}),
    });

  const applied = await applyPatch(sessionStore);
  if (!applied.ok) {
    return applied;
  }

  replaceSessionEntryContents(sessionEntry, applied.entry);
  sessionStore[sessionKey] = sessionEntry;

  if (!params.storePath) {
    return { ok: true, entry: sessionEntry };
  }

  const persisted = await updateSessionStore(params.storePath, async (store) => {
    const next = await applyPatch(store);
    if (!next.ok) {
      throw new Error(`session patch persistence failed: ${next.error.message}`);
    }
    return next.entry;
  });
  const finalEntry = persisted ?? sessionEntry;
  replaceSessionEntryContents(sessionEntry, finalEntry);
  sessionStore[sessionKey] = sessionEntry;
  return { ok: true, entry: sessionEntry };
}

export async function applySharedModelSelection(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  selection: ModelOverrideSelection;
  profileOverride?: string;
  profileOverrideSource?: "auto" | "user";
}): Promise<{ updated: boolean; entry?: SessionEntry }> {
  const { sessionEntry, sessionStore, sessionKey } = params;
  if (!sessionEntry || !sessionStore || !sessionKey) {
    return { updated: false, entry: sessionEntry };
  }

  return await persistMutatedSessionEntry({
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath: params.storePath,
    apply: (entry) =>
      applyModelOverrideToSessionEntry({
        entry,
        selection: params.selection,
        profileOverride: params.profileOverride,
        profileOverrideSource: params.profileOverrideSource,
      }),
  });
}
