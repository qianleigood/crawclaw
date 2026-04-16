import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";

const sessionFinalizeMocks = vi.hoisted(() => ({
  updateSessionStore: vi.fn(),
  archivePreviousSessionArtifacts: vi.fn(),
}));

vi.mock("../../config/sessions/store.js", () => ({
  updateSessionStore: sessionFinalizeMocks.updateSessionStore,
}));

vi.mock("../../sessions/runtime/reset-artifacts.js", () => ({
  archivePreviousSessionArtifacts: sessionFinalizeMocks.archivePreviousSessionArtifacts,
}));

const { finalizeSessionInitState } = await import("./session-finalize.js");

describe("finalizeSessionInitState", () => {
  beforeEach(() => {
    sessionFinalizeMocks.updateSessionStore
      .mockReset()
      .mockImplementation(async (_path, mutator) => {
        const store: Record<string, SessionEntry> = {};
        return await mutator(store);
      });
    sessionFinalizeMocks.archivePreviousSessionArtifacts.mockReset().mockResolvedValue([]);
  });

  it("clears new-session runtime counters, persists the entry, and archives the previous session", async () => {
    const sessionStore: Record<string, SessionEntry> = {
      "agent:main:telegram:direct:123": {
        sessionId: "prev-session",
        updatedAt: 1_700_000_000_000,
      } as SessionEntry,
    };
    const sessionEntry = {
      sessionId: "next-session",
      updatedAt: 1_800_000_000_000,
      compactionCount: 9,
      memoryFlushCompactionCount: 2,
      memoryFlushAt: 123,
      memoryFlushContextHash: "hash",
      totalTokens: 50,
      inputTokens: 20,
      outputTokens: 30,
      estimatedCostUsd: 0.123,
      contextTokens: 999,
    } as SessionEntry;

    const result = await finalizeSessionInitState({
      cfg: {} as never,
      sessionStore,
      sessionKey: "agent:main:telegram:direct:123",
      sessionEntry,
      storePath: "/tmp/sessions.json",
      retiredLegacyMainDelivery: {
        key: "agent:main:main",
        entry: { sessionId: "legacy-session", updatedAt: 1 } as SessionEntry,
      },
      previousSessionEntry: {
        sessionId: "prev-session",
        sessionFile: "/tmp/prev.jsonl",
        updatedAt: 1,
      } as SessionEntry,
      agentId: "main",
      isNewSession: true,
    });

    expect(result.compactionCount).toBe(0);
    expect(result.memoryFlushCompactionCount).toBeUndefined();
    expect(result.memoryFlushAt).toBeUndefined();
    expect(result.memoryFlushContextHash).toBeUndefined();
    expect(result.totalTokens).toBeUndefined();
    expect(result.inputTokens).toBeUndefined();
    expect(result.outputTokens).toBeUndefined();
    expect(result.estimatedCostUsd).toBeUndefined();
    expect(result.contextTokens).toBeUndefined();
    expect(sessionStore["agent:main:telegram:direct:123"]).toMatchObject({
      sessionId: "next-session",
      compactionCount: 0,
    });
    expect(sessionFinalizeMocks.updateSessionStore).toHaveBeenCalledTimes(1);
    expect(sessionFinalizeMocks.archivePreviousSessionArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "prev-session",
        sessionFile: "/tmp/prev.jsonl",
        agentId: "main",
        disposeMcpRuntime: true,
      }),
    );
  });
});
