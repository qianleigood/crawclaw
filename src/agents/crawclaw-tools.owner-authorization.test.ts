import { describe, expect, it } from "vitest";
import { createCrawClawTools } from "./crawclaw-tools.js";

function readToolByName() {
  return new Map(createCrawClawTools().map((tool) => [tool.name, tool]));
}

describe("createCrawClawTools owner authorization", () => {
  it("keeps Rust-owned tools out of the thin TS registration layer", () => {
    const tools = readToolByName();
    expect(tools.has("cron")).toBe(false);
    expect(tools.has("memory_manifest_read")).toBe(false);
    expect(tools.has("memory_note_write")).toBe(false);
    expect(tools.has("memory_note_delete")).toBe(false);
    expect(tools.has("write_experience_note")).toBe(false);
    expect(tools.has("canvas")).toBe(false);
  });

  it("keeps retained TS tools non-owner-only in raw registration", () => {
    const tools = readToolByName();
    expect(tools.get("message")).toBeDefined();
    expect(tools.get("message")?.ownerOnly).not.toBe(true);
    expect(tools.get("tts")).toBeDefined();
    expect(tools.get("tts")?.ownerOnly).not.toBe(true);
    expect(tools.get("workflow")).toBeDefined();
    expect(tools.get("workflow")?.ownerOnly).not.toBe(true);
    expect(tools.get("workflowize")).toBeDefined();
    expect(tools.get("workflowize")?.ownerOnly).not.toBe(true);
  });
});
