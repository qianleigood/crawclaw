import { describe, expect, it } from "vitest";
import {
  CHAT_SESSION_CACHE_DESCRIPTOR,
  getChatSessionCacheMeta,
  getOrCreateSessionCacheValue,
  MAX_CACHED_CHAT_SESSIONS,
} from "./session-cache.ts";

describe("chat/session-cache", () => {
  it("evicts the least recently used session once the cache is full", () => {
    const cache = new Map<string, number>();

    for (let index = 0; index < MAX_CACHED_CHAT_SESSIONS; index += 1) {
      getOrCreateSessionCacheValue(cache, `session-${index}`, () => index);
    }
    getOrCreateSessionCacheValue(cache, "session-0", () => 0);
    getOrCreateSessionCacheValue(cache, "session-overflow", () => 999);

    expect(cache.has("session-1")).toBe(false);
    expect(cache.has("session-0")).toBe(true);
    expect(getChatSessionCacheMeta(cache)).toEqual({
      size: MAX_CACHED_CHAT_SESSIONS,
      maxSize: MAX_CACHED_CHAT_SESSIONS,
    });
  });

  it("publishes explicit governance metadata", () => {
    expect(CHAT_SESSION_CACHE_DESCRIPTOR.category).toBe("file_ui");
    expect(CHAT_SESSION_CACHE_DESCRIPTOR.owner).toBe("ui/chat");
    expect(CHAT_SESSION_CACHE_DESCRIPTOR.invalidation).toContain(
      "Least-recently-used entry evicted when size exceeds MAX_CACHED_CHAT_SESSIONS",
    );
  });
});
