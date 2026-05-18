import { afterEach, describe, expect, it } from "vitest";
import { setActiveCliLocale } from "./i18n/text.js";
import { stylePromptHint, stylePromptMessage, stylePromptTitle } from "./prompt-style.js";

describe("prompt style i18n", () => {
  afterEach(() => {
    setActiveCliLocale("en");
  });

  it("localizes exact prompt message, title, and hint text", () => {
    setActiveCliLocale("zh-CN");

    expect(stylePromptMessage("Workspace directory")).toContain("工作区目录");
    expect(stylePromptTitle("Note")).toContain("提示");
    expect(stylePromptHint("Recommended default")).toContain("推荐默认值");
  });
});
