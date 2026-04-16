import { describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import type { HookRunner } from "../../plugins/hooks.js";
import { emitSessionRolloverHooks } from "./reset-lifecycle.js";

describe("emitSessionRolloverHooks", () => {
  function buildHookRunner() {
    return {
      hasHooks: vi.fn<HookRunner["hasHooks"]>(() => true),
      runSessionEnd: vi.fn(async () => {}),
      runSessionStart: vi.fn(async () => {}),
    };
  }

  it("emits session_end for the previous session and session_start for the new session", async () => {
    const hookRunner = buildHookRunner();

    emitSessionRolloverHooks({
      hookRunner,
      isNewSession: true,
      sessionId: "session-new",
      previousSessionId: "session-old",
      sessionKey: "agent:main:telegram:direct:123",
      cfg: {} as CrawClawConfig,
    });

    await vi.waitFor(() => {
      expect(hookRunner.runSessionEnd).toHaveBeenCalledTimes(1);
      expect(hookRunner.runSessionStart).toHaveBeenCalledTimes(1);
    });
    expect(hookRunner.runSessionEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-old",
        sessionKey: "agent:main:telegram:direct:123",
        messageCount: 0,
      }),
      expect.objectContaining({
        sessionId: "session-old",
        sessionKey: "agent:main:telegram:direct:123",
      }),
    );
    expect(hookRunner.runSessionStart).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-new",
        sessionKey: "agent:main:telegram:direct:123",
        resumedFrom: "session-old",
      }),
      expect.objectContaining({
        sessionId: "session-new",
        sessionKey: "agent:main:telegram:direct:123",
      }),
    );
  });

  it("skips lifecycle hooks when the session was not rolled over", async () => {
    const hookRunner = buildHookRunner();

    emitSessionRolloverHooks({
      hookRunner,
      isNewSession: false,
      sessionId: "session-existing",
      previousSessionId: "session-existing",
      sessionKey: "agent:main:telegram:direct:123",
      cfg: {} as CrawClawConfig,
    });

    await Promise.resolve();
    expect(hookRunner.runSessionEnd).not.toHaveBeenCalled();
    expect(hookRunner.runSessionStart).not.toHaveBeenCalled();
  });

  it("does not emit session_end when the previous and next ids are the same", async () => {
    const hookRunner = buildHookRunner();

    emitSessionRolloverHooks({
      hookRunner,
      isNewSession: true,
      sessionId: "session-same",
      previousSessionId: "session-same",
      sessionKey: "agent:main:telegram:direct:123",
      cfg: {} as CrawClawConfig,
    });

    await vi.waitFor(() => {
      expect(hookRunner.runSessionStart).toHaveBeenCalledTimes(1);
    });
    expect(hookRunner.runSessionEnd).not.toHaveBeenCalled();
  });
});
