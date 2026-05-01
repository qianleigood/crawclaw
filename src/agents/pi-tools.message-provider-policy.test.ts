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

  it("hides host-gated memory manifest tool for main runs even when sender scope exists", () => {
    const tools = createCrawClawCodingTools({
      messageProvider: "smoke",
      senderId: "user-1",
    });
    const names = new Set(tools.map((tool) => tool.name));
    expect(names.has("memory_manifest_read")).toBe(false);
  });

  it("hides all host-gated scoped memory file tools for main runs when sender scope exists", () => {
    const tools = createCrawClawCodingTools({
      messageProvider: "smoke",
      senderId: "user-1",
    });
    const names = new Set(tools.map((tool) => tool.name));
    expect(names.has("memory_manifest_read")).toBe(false);
    expect(names.has("memory_note_read")).toBe(false);
    expect(names.has("memory_note_write")).toBe(false);
    expect(names.has("memory_note_edit")).toBe(false);
    expect(names.has("memory_note_delete")).toBe(false);
  });

  it.each([
    ["minimal", false],
    ["coding", true],
    ["messaging", false],
    ["full", true],
  ] as const)(
    "keeps host-gated memory tools hidden through local onboarding with the %s profile",
    (profile, expectsExperienceTool) => {
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

      expect(names.has("memory_manifest_read")).toBe(false);
      expect(names.has("memory_note_read")).toBe(false);
      expect(names.has("memory_note_write")).toBe(false);
      expect(names.has("memory_note_edit")).toBe(false);
      expect(names.has("memory_note_delete")).toBe(false);
      expect(names.has("write_experience_note")).toBe(expectsExperienceTool);
      expect(names.has("session_summary_file_read")).toBe(false);
      expect(names.has("session_summary_file_edit")).toBe(false);
      expect(names.has("submit_promotion_verdict")).toBe(false);
    },
  );

  it("keeps the coding profile experience write tool through local onboarding without a profile", () => {
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

    expect(names.has("memory_manifest_read")).toBe(false);
    expect(names.has("memory_note_read")).toBe(false);
    expect(names.has("memory_note_write")).toBe(false);
    expect(names.has("memory_note_edit")).toBe(false);
    expect(names.has("memory_note_delete")).toBe(false);
    expect(names.has("write_experience_note")).toBe(true);
    expect(names.has("session_summary_file_read")).toBe(false);
    expect(names.has("session_summary_file_edit")).toBe(false);
    expect(names.has("submit_promotion_verdict")).toBe(false);
  });

  it("exposes host-gated memory tools only when the host opens them for the turn", () => {
    const tools = createCrawClawCodingTools({
      messageProvider: "smoke",
      senderId: "user-1",
      runtimeToolAlsoAllow: [
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
      ],
    });
    const names = new Set(tools.map((tool) => tool.name));

    expect(names.has("memory_manifest_read")).toBe(true);
    expect(names.has("memory_note_read")).toBe(true);
    expect(names.has("memory_note_write")).toBe(true);
    expect(names.has("memory_note_edit")).toBe(true);
    expect(names.has("memory_note_delete")).toBe(true);
  });
});
