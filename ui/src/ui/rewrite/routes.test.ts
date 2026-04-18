import { describe, expect, it } from "vitest";
import { controlPagesForLocale, metaForPage } from "./routes.ts";

describe("rewrite routes locale metadata", () => {
  it("returns English control pages by default", () => {
    const pages = controlPagesForLocale();
    expect(pages[0]?.label).toBe("Overview");
    expect(pages.some((page) => page.id === "memory" && page.label === "Memory")).toBe(true);
    expect(pages.some((page) => page.id === "runtime" && page.label === "Runtime")).toBe(true);
    expect(metaForPage("config").eyebrow).toBe("Settings and approvals");
  });

  it("returns Simplified Chinese metadata when requested", () => {
    const pages = controlPagesForLocale("zh-CN");
    expect(pages[0]?.label).toBe("概览");
    expect(metaForPage("memory", "zh-CN").label).toBe("记忆");
    expect(metaForPage("sessions", "zh-CN").headline).toContain("打开一个会话");
    expect(metaForPage("runtime", "zh-CN").label).toBe("后台运行");
    expect(metaForPage("debug", "zh-CN").label).toBe("调试");
  });
});
