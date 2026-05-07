import { describe, expect, it } from "vitest";
import entry from "./index.js";
import { weixinPlugin } from "./src/channel.js";

describe("weixin channel entry", () => {
  it("registers the weixin bundled channel plugin", () => {
    expect(entry).toMatchObject({
      id: "weixin",
      name: "Weixin",
      description: "Weixin channel plugin",
    });
  });

  it("classifies @im.wechat ids as direct messaging targets", () => {
    expect(weixinPlugin.messaging?.inferTargetChatType?.({ to: "user@im.wechat" })).toBe("direct");
    expect(weixinPlugin.messaging?.targetResolver?.looksLikeId?.("user@im.wechat")).toBe(true);
    expect(weixinPlugin.messaging?.inferTargetChatType?.({ to: "not-weixin" })).toBeUndefined();
  });
});
