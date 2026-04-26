import { afterEach, describe, expect, it } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/index.js";
import { buildWaitingStatusMessage, pickWaitingPhrase } from "./tui-waiting.js";

const theme = {
  dim: (s: string) => `<d>${s}</d>`,
  bold: (s: string) => `<b>${s}</b>`,
  accentSoft: (s: string) => `<a>${s}</a>`,
  // oxlint-disable-next-line typescript/no-explicit-any
} as any;

describe("tui-waiting", () => {
  afterEach(() => {
    setActiveCliLocale("en");
  });

  it("pickWaitingPhrase rotates every 10 ticks", () => {
    const phrases = ["a", "b", "c"];
    expect(pickWaitingPhrase(0, phrases)).toBe("a");
    expect(pickWaitingPhrase(9, phrases)).toBe("a");
    expect(pickWaitingPhrase(10, phrases)).toBe("b");
    expect(pickWaitingPhrase(20, phrases)).toBe("c");
    expect(pickWaitingPhrase(30, phrases)).toBe("a");
  });

  it("buildWaitingStatusMessage includes shimmer markup and metadata", () => {
    const msg = buildWaitingStatusMessage({
      theme,
      tick: 1,
      elapsed: "3s",
      connectionStatus: "connected",
      phrases: ["hello"],
    });

    expect(msg).toContain("connected");
    expect(msg).toContain("3s");
    // text is wrapped per-char; check it appears in order
    expect(msg).toContain("h");
    expect(msg).toContain("e");
    expect(msg).toContain("l");
    expect(msg).toContain("o");
    // shimmer should contain both highlighted and dim parts
    expect(msg).toContain("<b><a>");
    expect(msg).toContain("<d>");
  });

  it("uses localized default waiting text in zh-CN", () => {
    setActiveCliLocale("zh-CN");

    const msg = buildWaitingStatusMessage({
      theme,
      tick: 0,
      elapsed: "3s",
      connectionStatus: "已连接",
    });
    const plain = msg.replace(/<\/?[a-z]>/g, "");

    expect(plain).toContain("思考中");
    expect(plain).not.toContain("flibbertigibbeting");
  });
});
