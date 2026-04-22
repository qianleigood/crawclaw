import { afterEach, describe, expect, it } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/text.js";
import { stylePromptHint, stylePromptMessage, stylePromptTitle } from "./prompt-style.js";

describe("prompt style i18n", () => {
  afterEach(() => {
    setActiveCliLocale("en");
  });

  it("localizes exact prompt message, title, and hint text", () => {
    setActiveCliLocale("zh-CN");

    expect(stylePromptMessage("Gateway port")).toContain("网关端口");
    expect(stylePromptTitle("Note")).toContain("提示");
    expect(stylePromptHint("Recommended default")).toContain("推荐默认值");
  });
});
