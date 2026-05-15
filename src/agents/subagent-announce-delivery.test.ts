import { describe, expect, it } from "vitest";
import { resolveAnnounceOrigin } from "./subagent-announce-delivery.js";

describe("resolveAnnounceOrigin feishu forum topics", () => {
  it("preserves stored forum topic thread ids when requester origin omits one for the same chat", () => {
    expect(
      resolveAnnounceOrigin(
        {
          lastChannel: "feishu",
          lastTo: "feishu:-1001234567890:topic:99",
          lastThreadId: 99,
        },
        {
          channel: "feishu",
          to: "feishu:-1001234567890",
        },
      ),
    ).toEqual({
      channel: "feishu",
      to: "feishu:-1001234567890",
      threadId: 99,
    });
  });

  it("preserves stored forum topic thread ids for legacy group-prefixed requester targets", () => {
    expect(
      resolveAnnounceOrigin(
        {
          lastChannel: "feishu",
          lastTo: "feishu:-1001234567890:topic:99",
          lastThreadId: 99,
        },
        {
          channel: "feishu",
          to: "group:-1001234567890",
        },
      ),
    ).toEqual({
      channel: "feishu",
      to: "group:-1001234567890",
      threadId: 99,
    });
  });

  it("still strips stale thread ids when the stored feishu route points at a different chat", () => {
    expect(
      resolveAnnounceOrigin(
        {
          lastChannel: "feishu",
          lastTo: "feishu:-1009999999999:topic:99",
          lastThreadId: 99,
        },
        {
          channel: "feishu",
          to: "feishu:-1001234567890",
        },
      ),
    ).toEqual({
      channel: "feishu",
      to: "feishu:-1001234567890",
    });
  });
});
