import { describe, expect, it } from "vitest";
import {
  CORE_TOOL_GROUPS,
  listCoreToolSections,
  listCoreToolIdsByLifecycle,
  resolveCoreToolProfilePolicy,
  resolveCoreToolLifecycle,
} from "./tool-catalog.js";

describe("tool-catalog", () => {
  it("includes durable memory and experience tools in the coding profile policy", () => {
    const policy = resolveCoreToolProfilePolicy("coding");
    expect(policy).toBeDefined();
    expect(policy!.allow).toContain("code_execution");
    expect(policy!.allow).toContain("web_search");
    expect(policy!.allow).toContain("x_search");
    expect(policy!.allow).toContain("web_fetch");
    expect(policy!.allow).toContain("browser");
    expect(policy!.allow).toContain("pdf");
    expect(policy!.allow).toContain("discover_skills");
    expect(policy!.allow).toContain("write_experience_note");
    expect(policy!.allow).toEqual(
      expect.arrayContaining([
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
      ]),
    );
    expect(policy!.allow).not.toContain("image_generate");
  });

  it("lists pdf in the media group and core tool sections", () => {
    expect(CORE_TOOL_GROUPS["group:media"]).toContain("pdf");
    const media = listCoreToolSections().find((section) => section.id === "media");
    expect(media?.tools.map((tool) => tool.id)).toEqual(
      expect.arrayContaining(["image", "pdf", "tts"]),
    );
  });

  it("classifies runtime, profile, and special-agent-only tools", () => {
    expect(resolveCoreToolLifecycle("browser")).toBe("runtime_conditional");
    expect(resolveCoreToolLifecycle("write_experience_note")).toBe("profile_default");
    expect(resolveCoreToolLifecycle("memory_manifest_read")).toBe("profile_default");
    expect(resolveCoreToolLifecycle("session_summary_file_read")).toBe("special_agent_only");
    expect(resolveCoreToolLifecycle("submit_promotion_verdict")).toBe("special_agent_only");

    expect(listCoreToolIdsByLifecycle("profile_default")).toEqual(
      expect.arrayContaining([
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
      ]),
    );
  });
});
