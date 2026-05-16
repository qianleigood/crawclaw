import { describe, expect, it } from "vitest";
import {
  RUST_CORE_TOOL_DEFINITIONS,
  RUST_NATIVE_TOOL_DEFINITIONS,
} from "./rust-tool-catalog.generated.js";
import {
  CORE_TOOL_GROUPS,
  isKnownCoreToolId,
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

  it("uses the generated Rust catalog snapshot for core and native tool ids", () => {
    const generatedIds = [
      ...RUST_CORE_TOOL_DEFINITIONS.map((tool) => tool.id),
      ...RUST_NATIVE_TOOL_DEFINITIONS.map((tool) => tool.id),
    ];
    expect(generatedIds).toEqual(expect.arrayContaining(["browser", "comfyui_workflow"]));
    for (const toolId of [
      "canvas",
      "message",
      "image",
      "pdf",
      "tts",
      "discover_skills",
      "workflow",
      "workflowize",
    ]) {
      expect(generatedIds).toContain(toolId);
      expect(isKnownCoreToolId(toolId)).toBe(true);
    }
  });
});
