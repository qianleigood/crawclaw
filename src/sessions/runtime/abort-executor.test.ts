import { beforeEach, describe, expect, it, vi } from "vitest";

const abortExecutorMocks = vi.hoisted(() => ({
  callGateway: vi.fn(async () => ({})),
}));

vi.mock("../../gateway/call.js", () => ({
  callGateway: abortExecutorMocks.callGateway,
}));

const { executeAbortTarget } = await import("./abort-executor.js");

describe("executeAbortTarget", () => {
  beforeEach(() => {
    abortExecutorMocks.callGateway.mockReset().mockResolvedValue({});
  });

  it("persists the abort target entry", async () => {
    const sessionStore = {};
    const result = await executeAbortTarget({
      entry: { sessionId: "session-1", updatedAt: Date.now() } as never,
      key: "agent:main:feishu:direct:123",
      legacyKeys: ["legacy:key"],
      sessionId: "session-1",
      sessionStore,
      abortCutoff: { messageSid: "55", timestamp: 1234567890000 },
      queueKeys: ["agent:main:feishu:direct:123", "session-1"],
    });

    expect(result).toMatchObject({
      aborted: false,
      persisted: true,
      cleared: {
        followupCleared: 0,
        laneCleared: 0,
        keys: ["agent:main:feishu:direct:123", "session-1"],
      },
    });
    expect(sessionStore).toMatchObject({
      "agent:main:feishu:direct:123": {
        abortedLastRun: true,
        abortCutoffMessageSid: "55",
        abortCutoffTimestamp: 1234567890000,
      },
    });
  });

  it("cancels ACP sessions before returning", async () => {
    await executeAbortTarget({
      cfg: {} as never,
      sessionKey: "acp:bound-session",
      acpCancelReason: "stop",
      queueKeys: ["acp:bound-session"],
    });

    expect(abortExecutorMocks.callGateway).toHaveBeenCalledWith({
      method: "acp.session.cancel",
      params: {
        sessionKey: "acp:bound-session",
        reason: "stop",
      },
      timeoutMs: 10_000,
    });
  });

  it("swallows ACP cancel failures", async () => {
    abortExecutorMocks.callGateway.mockRejectedValueOnce(new Error("cancel failed"));

    const result = await executeAbortTarget({
      cfg: {} as never,
      sessionKey: "acp:bound-session",
      acpCancelReason: "fast-abort",
      queueKeys: ["acp:bound-session"],
    });

    expect(abortExecutorMocks.callGateway).toHaveBeenCalledWith({
      method: "acp.session.cancel",
      params: {
        sessionKey: "acp:bound-session",
        reason: "fast-abort",
      },
      timeoutMs: 10_000,
    });
    expect(result.cleared).toEqual({
      followupCleared: 0,
      laneCleared: 0,
      keys: ["acp:bound-session"],
    });
  });

  it("reports an unpersisted abort when no persistent target entry exists", async () => {
    const result = await executeAbortTarget({
      abortKey: "feishu:123",
      queueKeys: [],
    });

    expect(result).toMatchObject({
      aborted: false,
      persisted: false,
    });
  });
});
