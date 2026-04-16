export const MAX_CACHED_CHAT_SESSIONS = 20;

export const CHAT_SESSION_CACHE_DESCRIPTOR = {
  id: "ui.chat.session-cache",
  module: "ui/src/ui/chat/session-cache.ts",
  category: "file_ui",
  owner: "ui/chat",
  key: "sessionKey",
  lifecycle:
    "In-memory LRU-style cache for recent chat session UI helpers retained until explicit map clear, LRU eviction, or page reload.",
  invalidation: [
    "Least-recently-used entry evicted when size exceeds MAX_CACHED_CHAT_SESSIONS",
    "Callers can clear or replace their backing Map to drop UI state explicitly",
  ],
  observability: ["getChatSessionCacheMeta(map)"],
} as const;

export function getOrCreateSessionCacheValue<T>(
  map: Map<string, T>,
  sessionKey: string,
  create: () => T,
): T {
  if (map.has(sessionKey)) {
    const existing = map.get(sessionKey) as T;
    // Refresh insertion order so recently used sessions stay cached.
    map.delete(sessionKey);
    map.set(sessionKey, existing);
    return existing;
  }

  const created = create();
  map.set(sessionKey, created);
  while (map.size > MAX_CACHED_CHAT_SESSIONS) {
    const oldest = map.keys().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    map.delete(oldest);
  }
  return created;
}

export function getChatSessionCacheMeta<T>(map: Map<string, T>): {
  size: number;
  maxSize: number;
} {
  return {
    size: map.size,
    maxSize: MAX_CACHED_CHAT_SESSIONS,
  };
}
