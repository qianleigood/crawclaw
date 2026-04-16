import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandHandler } from "./commands-types.js";

const commandsSessionAbortMocks = vi.hoisted(() => ({
  executeAbortTarget: vi.fn(async () => ({
    aborted: false,
    persisted: true,
    cleared: { followupCleared: 0, laneCleared: 0, keys: [] as string[] },
  })),
  stopSubagentsForRequester: vi.fn(() => ({ stopped: 0 })),
  resolveSessionEntryForKey: vi.fn(() => ({
    entry: { sessionId: "session-1", updatedAt: Date.now() },
    key: "acp:bound-session",
    legacyKeys: ["legacy:acp:bound-session"],
  })),
  createInternalHookEvent: vi.fn(() => ({
    type: "command",
    action: "stop",
    sessionKey: "acp:bound-session",
    context: {},
    timestamp: new Date("2026-04-16T00:00:00.000Z"),
    messages: [],
  })),
  triggerInternalHook: vi.fn(async () => {}),
}));

vi.mock("../../sessions/runtime/abort-executor.js", () => ({
  executeAbortTarget: commandsSessionAbortMocks.executeAbortTarget,
}));

vi.mock("./abort.js", () => ({
  formatAbortReplyText: (stopped: number) => `stopped:${stopped}`,
  isAbortTrigger: () => false,
  resolveSessionEntryForKey: commandsSessionAbortMocks.resolveSessionEntryForKey,
  stopSubagentsForRequester: commandsSessionAbortMocks.stopSubagentsForRequester,
}));

vi.mock("./command-gates.js", () => ({
  rejectUnauthorizedCommand: () => null,
}));

vi.mock("../../hooks/internal-hooks.js", () => ({
  createInternalHookEvent: commandsSessionAbortMocks.createInternalHookEvent,
  triggerInternalHook: commandsSessionAbortMocks.triggerInternalHook,
}));

const { handleStopCommand } = await import("./commands-session-abort.js");

describe("handleStopCommand", () => {
  beforeEach(() => {
    commandsSessionAbortMocks.executeAbortTarget.mockClear();
    commandsSessionAbortMocks.stopSubagentsForRequester.mockClear();
    commandsSessionAbortMocks.resolveSessionEntryForKey.mockClear().mockReturnValue({
      entry: { sessionId: "session-1", updatedAt: Date.now() },
      key: "acp:bound-session",
      legacyKeys: ["legacy:acp:bound-session"],
    });
    commandsSessionAbortMocks.createInternalHookEvent.mockClear();
    commandsSessionAbortMocks.triggerInternalHook.mockClear();
  });

  it("passes ACP cancel metadata through the shared abort executor", async () => {
    const params = {
      cfg: {} as never,
      ctx: {} as never,
      command: {
        commandBodyNormalized: "/stop",
        abortKey: "telegram:user",
        surface: "telegram",
        senderId: "telegram:user",
      },
      sessionKey: "acp:bound-session",
      sessionEntry: { sessionId: "session-1", updatedAt: Date.now() },
      sessionStore: {
        "acp:bound-session": { sessionId: "session-1", updatedAt: Date.now() },
      },
      storePath: "/tmp/sessions.json",
    } as unknown as Parameters<CommandHandler>[0];

    const result = await handleStopCommand(params, true);

    expect(commandsSessionAbortMocks.executeAbortTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "acp:bound-session",
        sessionId: "session-1",
        legacyKeys: ["legacy:acp:bound-session"],
        sessionKey: "acp:bound-session",
        acpCancelReason: "stop",
      }),
    );
    expect(result).toEqual({
      shouldContinue: false,
      reply: { text: "stopped:0" },
    });
  });
});
