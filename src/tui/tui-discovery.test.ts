import { afterEach, describe, expect, it } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/index.js";
import { formatTuiFirstScreenHint } from "./tui-discovery.js";

describe("tui discovery hints", () => {
  afterEach(() => {
    setActiveCliLocale("en");
  });

  it("keeps the first-screen hint short and actionable", () => {
    const hint = formatTuiFirstScreenHint();

    expect(hint).toContain("/help");
    expect(hint).toContain("Ctrl+L");
    expect(hint).toContain("Ctrl+G");
    expect(hint).toContain("Ctrl+P");
    expect(hint).toContain("Ctrl+O");
    expect(hint.length).toBeLessThanOrEqual(120);
  });

  it("localizes the first-screen hint in zh-CN", () => {
    setActiveCliLocale("zh-CN");

    const hint = formatTuiFirstScreenHint();

    expect(hint).toContain("提示");
    expect(hint).toContain("Ctrl+L 模型");
    expect(hint).toContain("Ctrl+P 会话");
  });
});
