import type { CacheGovernanceDescriptor } from "../../cache/governance-types.js";
import { createExpiringMapCache, isCacheEnabled, resolveCacheTtlMs } from "../cache-utils.js";
import type { SessionEntry } from "./types.js";

type SessionStoreCacheEntry = {
  store: Record<string, SessionEntry>;
  mtimeMs?: number;
  sizeBytes?: number;
  serialized?: string;
};

type SerializedSessionStoreCacheEntry = {
  serialized: string;
  mtimeMs?: number;
  sizeBytes?: number;
};

const DEFAULT_SESSION_STORE_TTL_MS = 45_000; // 45 seconds (between 30-60s)

const SESSION_STORE_CACHE = createExpiringMapCache<string, SessionStoreCacheEntry>({
  ttlMs: getSessionStoreTtl,
});
const SESSION_STORE_SERIALIZED_CACHE = new Map<string, SerializedSessionStoreCacheEntry>();

export const SESSION_STORE_CACHE_DESCRIPTOR: CacheGovernanceDescriptor = {
  id: "config.sessions.store",
  module: "src/config/sessions/store-cache.ts",
  category: "file_ui",
  owner: "config/sessions",
  key: "storePath + file mtimeMs + sizeBytes for object and serialized write-through entries",
  lifecycle:
    "Per-process cache retained until TTL expiry, file fingerprint mismatch, explicit invalidation, or process restart.",
  invalidation: [
    "File mtime or size differs from the cached fingerprint",
    "invalidateSessionStoreCache(storePath) or clearSessionStoreCaches()",
    "CRAWCLAW_SESSION_CACHE_TTL_MS=0 disables object-cache reuse",
  ],
  observability: [
    "src/config/sessions.cache.test.ts covers external-write and same-mtime rewrite cases",
    "clearSessionStoreCacheForTest() resets state for targeted tests",
  ],
};

export function getSessionStoreTtl(): number {
  return resolveCacheTtlMs({
    envValue: process.env.CRAWCLAW_SESSION_CACHE_TTL_MS,
    defaultTtlMs: DEFAULT_SESSION_STORE_TTL_MS,
  });
}

export function isSessionStoreCacheEnabled(): boolean {
  return isCacheEnabled(getSessionStoreTtl());
}

export function clearSessionStoreCaches(): void {
  SESSION_STORE_CACHE.clear();
  SESSION_STORE_SERIALIZED_CACHE.clear();
}

export function invalidateSessionStoreCache(storePath: string): void {
  SESSION_STORE_CACHE.delete(storePath);
  SESSION_STORE_SERIALIZED_CACHE.delete(storePath);
}

export function getSerializedSessionStore(params: {
  storePath: string;
  mtimeMs?: number;
  sizeBytes?: number;
}): string | undefined {
  const cached = SESSION_STORE_SERIALIZED_CACHE.get(params.storePath);
  if (!cached) {
    return undefined;
  }
  if (params.mtimeMs !== cached.mtimeMs || params.sizeBytes !== cached.sizeBytes) {
    SESSION_STORE_SERIALIZED_CACHE.delete(params.storePath);
    return undefined;
  }
  return cached.serialized;
}

export function setSerializedSessionStore(params: {
  storePath: string;
  serialized?: string;
  mtimeMs?: number;
  sizeBytes?: number;
}): void {
  if (params.serialized === undefined) {
    SESSION_STORE_SERIALIZED_CACHE.delete(params.storePath);
    return;
  }
  SESSION_STORE_SERIALIZED_CACHE.set(params.storePath, {
    serialized: params.serialized,
    mtimeMs: params.mtimeMs,
    sizeBytes: params.sizeBytes,
  });
}

export function dropSessionStoreObjectCache(storePath: string): void {
  SESSION_STORE_CACHE.delete(storePath);
}

export function readSessionStoreCache(params: {
  storePath: string;
  mtimeMs?: number;
  sizeBytes?: number;
}): Record<string, SessionEntry> | null {
  const cached = SESSION_STORE_CACHE.get(params.storePath);
  if (!cached) {
    return null;
  }
  if (params.mtimeMs !== cached.mtimeMs || params.sizeBytes !== cached.sizeBytes) {
    invalidateSessionStoreCache(params.storePath);
    return null;
  }
  return structuredClone(cached.store);
}

export function writeSessionStoreCache(params: {
  storePath: string;
  store: Record<string, SessionEntry>;
  mtimeMs?: number;
  sizeBytes?: number;
  serialized?: string;
}): void {
  SESSION_STORE_CACHE.set(params.storePath, {
    store: structuredClone(params.store),
    mtimeMs: params.mtimeMs,
    sizeBytes: params.sizeBytes,
    serialized: params.serialized,
  });
  if (params.serialized !== undefined) {
    SESSION_STORE_SERIALIZED_CACHE.set(params.storePath, {
      serialized: params.serialized,
      mtimeMs: params.mtimeMs,
      sizeBytes: params.sizeBytes,
    });
  }
}
