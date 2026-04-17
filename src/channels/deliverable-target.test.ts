import { describe, expect, it } from "vitest";
import {
  buildDeliverableTargetKey,
  normalizeDeliverableChannel,
  resolveDeliverableTarget,
} from "./deliverable-target.js";

describe("deliverable target", () => {
  it("normalizes a deliverable channel", () => {
    expect(normalizeDeliverableChannel(" Telegram ")).toBe("telegram");
    expect(normalizeDeliverableChannel("webchat")).toBeUndefined();
  });

  it("resolves deliverable targets only when channel and to are valid", () => {
    expect(
      resolveDeliverableTarget({
        channel: "telegram",
        to: "12345",
        accountId: "main",
        threadId: 7,
      }),
    ).toEqual({
      channel: "telegram",
      to: "12345",
      accountId: "main",
      threadId: 7,
    });

    expect(resolveDeliverableTarget({ channel: "webchat", to: "12345" })).toBeNull();
    expect(resolveDeliverableTarget({ channel: "telegram", to: "   " })).toBeNull();
  });

  it("builds stable keys for raw and normalized targets", () => {
    expect(
      buildDeliverableTargetKey({
        channel: " Telegram ",
        to: "12345",
        accountId: "main",
        threadId: 7,
      }),
    ).toBe("telegram:12345:main:7");

    expect(
      buildDeliverableTargetKey({
        channel: "webchat",
        to: "session:abc",
      }),
    ).toBe("webchat:session:abc::");
  });
});
