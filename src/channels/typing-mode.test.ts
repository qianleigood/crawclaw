import { describe, expect, it, vi } from "vitest";
import { createTypingSignaler, resolveTypingMode } from "./typing-mode.js";

describe("resolveTypingMode", () => {
  it("returns never for suppressed or system typing policies", () => {
    expect(
      resolveTypingMode({
        isGroupChat: false,
        wasMentioned: false,
        isHeartbeat: true,
      }),
    ).toBe("never");
    expect(
      resolveTypingMode({
        isGroupChat: false,
        wasMentioned: false,
        isHeartbeat: false,
        typingPolicy: "system_event",
      }),
    ).toBe("never");
    expect(
      resolveTypingMode({
        isGroupChat: false,
        wasMentioned: false,
        isHeartbeat: false,
        suppressTyping: true,
      }),
    ).toBe("never");
  });

  it("defaults group chats to message mode and direct chats to instant", () => {
    expect(
      resolveTypingMode({
        isGroupChat: true,
        wasMentioned: false,
        isHeartbeat: false,
      }),
    ).toBe("message");
    expect(
      resolveTypingMode({
        isGroupChat: false,
        wasMentioned: false,
        isHeartbeat: false,
      }),
    ).toBe("instant");
  });
});

describe("createTypingSignaler", () => {
  it("starts typing on renderable text and keeps ttl alive for tools", async () => {
    const typing = {
      startTypingLoop: vi.fn().mockResolvedValue(undefined),
      startTypingOnText: vi.fn().mockResolvedValue(undefined),
      refreshTypingTtl: vi.fn(),
      isActive: vi.fn().mockReturnValue(false),
    };

    const signaler = createTypingSignaler({
      typing,
      mode: "message",
      isHeartbeat: false,
    });

    await signaler.signalTextDelta("hello");
    await signaler.signalToolStart();

    expect(typing.startTypingOnText).toHaveBeenCalledWith("hello");
    expect(typing.startTypingLoop).toHaveBeenCalledTimes(1);
    expect(typing.refreshTypingTtl).toHaveBeenCalledTimes(1);
  });
});
