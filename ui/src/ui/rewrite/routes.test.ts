import { describe, expect, it } from "vitest";
import { controlPagesForLocale, metaForPage } from "./routes.ts";

describe("rewrite routes locale metadata", () => {
  it("returns English control pages by default", () => {
    const pages = controlPagesForLocale();
    expect(pages[0]?.label).toBe("Sessions & Chat");
    expect(pages.some((page) => page.id === "overview")).toBe(false);
    expect(pages.some((page) => page.id === "memory" && page.label === "Memory")).toBe(true);
    expect(pages.some((page) => page.id === "runtime" && page.label === "Agent Runtime")).toBe(
      true,
    );
    expect(metaForPage("config", "en").eyebrow).toBe("APPROVALS & CONFIG");
    expect(metaForPage("channels").icon).toBe("hub");
  });

  it("returns Simplified Chinese metadata when requested", () => {
    const pages = controlPagesForLocale("zh-CN");
    expect(pages[0]?.label).toBe("会话控制台");
    expect(pages.some((page) => page.id === "overview")).toBe(false);
    expect(metaForPage("memory", "zh-CN").label).toBe("记忆");
    expect(metaForPage("sessions", "zh-CN").headline).toContain("打开一个活动会话");
    expect(metaForPage("runtime", "zh-CN").label).toBe("后台运行");
    expect(metaForPage("debug", "zh-CN").label).toBe("RPC 调试");
  });
});
