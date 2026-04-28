import { describe, expect, it } from "vitest";
import {
  CORE_TOOL_GROUPS,
  listCoreToolSections,
  resolveCoreToolProfilePolicy,
} from "./tool-catalog.js";

describe("tool-catalog", () => {
  it("includes code_execution, web_search, x_search, web_fetch, and pdf in the coding profile policy", () => {
    const policy = resolveCoreToolProfilePolicy("coding");
    expect(policy).toBeDefined();
    expect(policy!.allow).toContain("code_execution");
    expect(policy!.allow).toContain("web_search");
    expect(policy!.allow).toContain("x_search");
    expect(policy!.allow).toContain("web_fetch");
    expect(policy!.allow).toContain("pdf");
    expect(policy!.allow).not.toContain("image_generate");
  });

  it("lists pdf in the media group and core tool sections", () => {
    expect(CORE_TOOL_GROUPS["group:media"]).toContain("pdf");
    const media = listCoreToolSections().find((section) => section.id === "media");
    expect(media?.tools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining(["image", "pdf", "tts"]),
    );
  });
});
