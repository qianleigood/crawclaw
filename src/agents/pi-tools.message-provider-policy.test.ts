import { describe, expect, it } from "vitest";
import { createCrawClawCodingTools } from "./pi-tools.js";

describe("createCrawClawCodingTools message provider policy", () => {
  it.each(["voice", "VOICE", " Voice "])(
    "does not expose tts tool for normalized voice provider: %s",
    (messageProvider) => {
      const tools = createCrawClawCodingTools({ messageProvider });
      const names = new Set(tools.map((tool) => tool.name));
      expect(names.has("tts")).toBe(false);
    },
  );

  it("keeps tts tool for non-voice providers", () => {
    const tools = createCrawClawCodingTools({ messageProvider: "discord" });
    const names = new Set(tools.map((tool) => tool.name));
    expect(names.has("tts")).toBe(true);
  });

  it("keeps memory manifest tool for non-gateway providers when sender scope exists", () => {
    const tools = createCrawClawCodingTools({
      messageProvider: "smoke",
      senderId: "user-1",
    });
    const names = new Set(tools.map((tool) => tool.name));
    expect(names.has("memory_manifest_read")).toBe(true);
  });

  it("keeps all scoped memory file tools for non-gateway providers when sender scope exists", () => {
    const tools = createCrawClawCodingTools({
      messageProvider: "smoke",
      senderId: "user-1",
    });
    const names = new Set(tools.map((tool) => tool.name));
    expect(names.has("memory_manifest_read")).toBe(true);
    expect(names.has("memory_note_read")).toBe(true);
    expect(names.has("memory_note_write")).toBe(true);
    expect(names.has("memory_note_edit")).toBe(true);
    expect(names.has("memory_note_delete")).toBe(true);
  });
});
