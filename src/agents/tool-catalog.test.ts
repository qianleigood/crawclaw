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
    expect(policy!.allow).toContain("bash");
    expect(policy!.allow).toContain("grep");
    expect(policy!.allow).toContain("find");
    expect(policy!.allow).toContain("ls");
    expect(policy!.allow).toContain("web_search");
    expect(policy!.allow).toContain("web_fetch");
    expect(policy!.allow).toContain("browser");
    expect(policy!.allow).toContain("discover_skills");
    expect(policy!.allow).toContain("write_experience_note");
    expect(policy!.allow).toEqual(expect.arrayContaining(["sessions_spawn", "sessions_yield"]));
    expect(policy!.allow).not.toContain("gateway");
    expect(policy!.allow).not.toContain("sessions_list");
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
    expect(resolveCoreToolLifecycle("memory_manifest_read")).toBe("special_agent_only");
    expect(resolveCoreToolLifecycle("session_summary_file_read")).toBe("special_agent_only");
    expect(listCoreToolIdsByLifecycle("special_agent_only")).toEqual(
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
