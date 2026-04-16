import { beforeEach, describe, expect, it, vi } from "vitest";

const abortExecutorMocks = vi.hoisted(() => ({
  abortEmbeddedPiRun: vi.fn(),
  persistAbortTargetEntry: vi.fn(),
  setAbortMemory: vi.fn(),
  clearSessionQueues: vi.fn(),
  resolveSession: vi.fn<
    () =>
      | { kind: "none" }
      | {
          kind: "ready";
          sessionKey: string;
          meta: unknown;
        }
  >(() => ({ kind: "none" })),
  cancelSession: vi.fn(async () => {}),
}));

vi.mock("../../acp/control-plane/manager.js", () => ({
  getAcpSessionManager: () => ({
    resolveSession: abortExecutorMocks.resolveSession,
    cancelSession: abortExecutorMocks.cancelSession,
  }),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: abortExecutorMocks.abortEmbeddedPiRun,
}));

vi.mock("../../auto-reply/reply/commands-session-store.js", () => ({
  persistAbortTargetEntry: abortExecutorMocks.persistAbortTargetEntry,
}));

vi.mock("../../auto-reply/reply/abort-primitives.js", () => ({
  setAbortMemory: abortExecutorMocks.setAbortMemory,
}));

vi.mock("../../auto-reply/reply/queue.js", () => ({
  clearSessionQueues: abortExecutorMocks.clearSessionQueues,
}));

const { executeAbortTarget } = await import("./abort-executor.js");

describe("executeAbortTarget", () => {
  beforeEach(() => {
    abortExecutorMocks.abortEmbeddedPiRun.mockReset().mockReturnValue(true);
    abortExecutorMocks.persistAbortTargetEntry.mockReset().mockResolvedValue(true);
    abortExecutorMocks.setAbortMemory.mockReset();
    abortExecutorMocks.clearSessionQueues.mockReset().mockReturnValue({
      followupCleared: 1,
      laneCleared: 0,
      keys: ["agent:main:telegram:direct:123"],
    });
    abortExecutorMocks.resolveSession.mockReset().mockReturnValue({ kind: "none" });
    abortExecutorMocks.cancelSession.mockReset().mockResolvedValue(undefined);
  });

  it("clears queues, aborts embedded runs, and persists the abort target entry", async () => {
    const result = await executeAbortTarget({
      entry: { sessionId: "session-1", updatedAt: Date.now() } as never,
      key: "agent:main:telegram:direct:123",
      legacyKeys: ["legacy:key"],
      sessionId: "session-1",
      sessionStore: {} as never,
      storePath: "/tmp/sessions.json",
      abortCutoff: { messageSid: "55", timestamp: 1234567890000 },
      queueKeys: ["agent:main:telegram:direct:123", "session-1"],
    });

    expect(result).toMatchObject({
      aborted: true,
      persisted: true,
      cleared: {
        followupCleared: 1,
        laneCleared: 0,
        keys: ["agent:main:telegram:direct:123"],
      },
    });
    expect(abortExecutorMocks.clearSessionQueues).toHaveBeenCalledWith([
      "agent:main:telegram:direct:123",
      "session-1",
    ]);
    expect(abortExecutorMocks.abortEmbeddedPiRun).toHaveBeenCalledWith("session-1");
    expect(abortExecutorMocks.persistAbortTargetEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "agent:main:telegram:direct:123",
        legacyKeys: ["legacy:key"],
        abortCutoff: { messageSid: "55", timestamp: 1234567890000 },
      }),
    );
    expect(abortExecutorMocks.setAbortMemory).not.toHaveBeenCalled();
  });

  it("cancels ACP sessions before clearing queues when the target resolves to ACP", async () => {
    abortExecutorMocks.resolveSession.mockReturnValue({
      kind: "ready",
      sessionKey: "acp:bound-session",
      meta: {},
    });

    await executeAbortTarget({
      cfg: {} as never,
      sessionKey: "acp:bound-session",
      acpCancelReason: "stop",
      queueKeys: ["acp:bound-session"],
    });

    expect(abortExecutorMocks.cancelSession).toHaveBeenCalledWith({
      cfg: {},
      sessionKey: "acp:bound-session",
      reason: "stop",
    });
    expect(abortExecutorMocks.clearSessionQueues).toHaveBeenCalledWith(["acp:bound-session"]);
  });

  it("swallows ACP cancel failures and still clears queues", async () => {
    abortExecutorMocks.resolveSession.mockReturnValue({
      kind: "ready",
      sessionKey: "acp:bound-session",
      meta: {},
    });
    abortExecutorMocks.cancelSession.mockRejectedValueOnce(new Error("cancel failed"));

    const result = await executeAbortTarget({
      cfg: {} as never,
      sessionKey: "acp:bound-session",
      acpCancelReason: "fast-abort",
      queueKeys: ["acp:bound-session"],
    });

    expect(abortExecutorMocks.cancelSession).toHaveBeenCalledWith({
      cfg: {},
      sessionKey: "acp:bound-session",
      reason: "fast-abort",
    });
    expect(result.cleared).toEqual({
      followupCleared: 1,
      laneCleared: 0,
      keys: ["agent:main:telegram:direct:123"],
    });
    expect(abortExecutorMocks.clearSessionQueues).toHaveBeenCalledWith(["acp:bound-session"]);
  });

  it("falls back to abort memory when no persistent target entry exists", async () => {
    abortExecutorMocks.persistAbortTargetEntry.mockResolvedValue(false);

    const result = await executeAbortTarget({
      abortKey: "telegram:123",
      queueKeys: [],
    });

    expect(result).toMatchObject({
      aborted: false,
      persisted: false,
    });
    expect(abortExecutorMocks.setAbortMemory).toHaveBeenCalledWith("telegram:123", true);
  });
});
