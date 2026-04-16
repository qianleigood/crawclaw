import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";

const resetInternalHookMocks = vi.hoisted(() => ({
  createInternalHookEvent: vi.fn(),
  triggerInternalHook: vi.fn(),
}));

vi.mock("../../hooks/internal-hooks.js", () => ({
  createInternalHookEvent: resetInternalHookMocks.createInternalHookEvent,
  triggerInternalHook: resetInternalHookMocks.triggerInternalHook,
}));

const { emitResetInternalHook } = await import("./reset-internal-hook.js");

describe("emitResetInternalHook", () => {
  beforeEach(() => {
    resetInternalHookMocks.createInternalHookEvent.mockReset().mockReturnValue({
      type: "command",
      action: "new",
      sessionKey: "agent:main:telegram:direct:123",
      context: {},
      timestamp: new Date("2026-04-16T00:00:00.000Z"),
      messages: [],
    });
    resetInternalHookMocks.triggerInternalHook.mockReset().mockResolvedValue(undefined);
  });

  it("creates and triggers a reset internal hook event with the shared reset context", async () => {
    const hookEvent = await emitResetInternalHook({
      action: "new",
      sessionKey: "agent:main:telegram:direct:123",
      sessionEntry: { sessionId: "next-session" } as never,
      previousSessionEntry: { sessionId: "prev-session" } as never,
      commandSource: "/new summarize",
      cfg: {} as CrawClawConfig,
      senderId: "telegram:user",
      workspaceDir: "/tmp/crawclaw-workspace",
    });

    expect(resetInternalHookMocks.createInternalHookEvent).toHaveBeenCalledWith(
      "command",
      "new",
      "agent:main:telegram:direct:123",
      expect.objectContaining({
        sessionEntry: expect.objectContaining({ sessionId: "next-session" }),
        previousSessionEntry: expect.objectContaining({ sessionId: "prev-session" }),
        commandSource: "/new summarize",
        senderId: "telegram:user",
        workspaceDir: "/tmp/crawclaw-workspace",
        cfg: {},
      }),
    );
    expect(resetInternalHookMocks.triggerInternalHook).toHaveBeenCalledWith(hookEvent);
  });
});
