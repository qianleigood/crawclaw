import { describe, expect, it } from "vitest";
import { DEFAULT_TABLE_MODES, resolveMarkdownTableMode } from "./markdown-tables.js";

describe("DEFAULT_TABLE_MODES", () => {
  it("does not carry legacy channel-specific defaults", () => {
    expect(DEFAULT_TABLE_MODES.get("feishu")).toBeUndefined();
    expect(DEFAULT_TABLE_MODES.get("signal")).toBeUndefined();
    expect(DEFAULT_TABLE_MODES.get("weixin")).toBeUndefined();
    expect(DEFAULT_TABLE_MODES.get("ddingtalk")).toBeUndefined();
  });
});

describe("resolveMarkdownTableMode", () => {
  it("defaults to code for retained channels", () => {
    expect(resolveMarkdownTableMode({ channel: "feishu" })).toBe("code");
  });

  it("coerces explicit block mode to code for retained channels", () => {
    const cfg = { channels: { feishu: { markdown: { tables: "block" as const } } } };
    expect(resolveMarkdownTableMode({ cfg, channel: "feishu" })).toBe("code");
  });
});
