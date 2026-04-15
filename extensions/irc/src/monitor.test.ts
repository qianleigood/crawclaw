import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#crawclaw",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#crawclaw",
      rawTarget: "#crawclaw",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "crawclaw-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "crawclaw-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "crawclaw-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "crawclaw-bot",
      rawTarget: "crawclaw-bot",
    });
  });
});
