import { describe, expect, it } from "vitest";
import { createReplyToModeFilter, createReplyToModeFilterForChannel } from "./reply-threading.js";

describe("createReplyToModeFilter", () => {
  it("drops replyToId in off mode", () => {
    const filter = createReplyToModeFilter("off");
    expect(filter({ text: "hello", replyToId: "msg-1" })).toEqual({
      text: "hello",
      replyToId: undefined,
    });
  });

  it("keeps explicit reply tags when the channel allows them", () => {
    const filter = createReplyToModeFilterForChannel("off", "telegram");
    expect(
      filter({
        text: "hello",
        replyToId: "msg-1",
        replyToTag: true,
      }),
    ).toEqual({
      text: "hello",
      replyToId: "msg-1",
      replyToTag: true,
    });
  });

  it("threads only the first non-compaction payload in first mode", () => {
    const filter = createReplyToModeFilter("first");

    expect(filter({ text: "status", replyToId: "msg-1", isCompactionNotice: true })).toEqual({
      text: "status",
      replyToId: "msg-1",
      isCompactionNotice: true,
    });
    expect(filter({ text: "reply", replyToId: "msg-1" })).toEqual({
      text: "reply",
      replyToId: "msg-1",
    });
    expect(filter({ text: "followup", replyToId: "msg-2" })).toEqual({
      text: "followup",
      replyToId: undefined,
    });
  });
});
