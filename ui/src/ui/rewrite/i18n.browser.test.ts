import { describe, expect, it } from "vitest";
import { controlPagesForLocale, metaForPage } from "./routes.ts";

describe("rewrite i18n metadata", () => {
  it("returns English-only shell labels for en", () => {
    const overview = controlPagesForLocale("en").find((page) => page.id === "overview");
    expect(overview).toBeUndefined();
    expect(metaForPage("sessions", "en").label).toBe("Sessions & Chat");
  });

  it("returns Chinese-only shell labels for zh-CN", () => {
    const overview = controlPagesForLocale("zh-CN").find((page) => page.id === "overview");
    expect(overview).toBeUndefined();
    expect(metaForPage("debug", "zh-CN").label).toBe("RPC 调试");
  });
});
