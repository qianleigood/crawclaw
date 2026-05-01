import { describe, expect, it } from "vitest";
import { applyLocalSetupWorkspaceConfig } from "../commands/onboard-config.js";
import type { CrawClawConfig } from "../config/config.js";
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

  it.each(["minimal", "coding", "messaging", "full"] as const)(
    "keeps designed main memory tools through local onboarding with the %s profile",
    (profile) => {
      const config = applyLocalSetupWorkspaceConfig(
        {
          plugins: {
            enabled: false,
          },
          tools: {
            profile,
          },
        } satisfies CrawClawConfig,
        "/tmp/workspace",
      );
      const tools = createCrawClawCodingTools({
        config,
        messageProvider: "feishu",
        senderId: "user-1",
        sessionKey: "agent:main:feishu:user-1",
      });
      const names = new Set(tools.map((tool) => tool.name));

      expect(names.has("memory_manifest_read")).toBe(true);
      expect(names.has("memory_note_read")).toBe(true);
      expect(names.has("memory_note_write")).toBe(true);
      expect(names.has("memory_note_edit")).toBe(true);
      expect(names.has("memory_note_delete")).toBe(true);
      expect(names.has("write_experience_note")).toBe(true);
      expect(names.has("memory_transcript_search")).toBe(false);
      expect(names.has("session_summary_file_read")).toBe(false);
      expect(names.has("session_summary_file_edit")).toBe(false);
      expect(names.has("submit_promotion_verdict")).toBe(false);
    },
  );

  it("keeps only designed main memory tools through local onboarding without a profile", () => {
    const config = applyLocalSetupWorkspaceConfig(
      {
        plugins: {
          enabled: false,
        },
      } satisfies CrawClawConfig,
      "/tmp/workspace",
    );
    const tools = createCrawClawCodingTools({
      config,
      messageProvider: "feishu",
      senderId: "user-1",
      sessionKey: "agent:main:feishu:user-1",
    });
    const names = new Set(tools.map((tool) => tool.name));

    expect(names.has("memory_manifest_read")).toBe(true);
    expect(names.has("memory_note_read")).toBe(true);
    expect(names.has("memory_note_write")).toBe(true);
    expect(names.has("memory_note_edit")).toBe(true);
    expect(names.has("memory_note_delete")).toBe(true);
    expect(names.has("write_experience_note")).toBe(true);
    expect(names.has("memory_transcript_search")).toBe(false);
    expect(names.has("session_summary_file_read")).toBe(false);
    expect(names.has("session_summary_file_edit")).toBe(false);
    expect(names.has("submit_promotion_verdict")).toBe(false);
  });
});
