import { describe, expect, it } from "vitest";
import { migrateLegacyConfig } from "./legacy-migrate.js";

describe("migrateLegacyConfig", () => {
  it("does not rewrite removed routing.transcribeAudio config", () => {
    const res = migrateLegacyConfig({
      routing: {
        transcribeAudio: {
          command: ["whisper", "--model", "base"],
        },
      },
    });

    expect(res).toEqual({ config: null, changes: [] });
  });

  it("does not rewrite removed channels.telegram.groupMentionsOnly config", () => {
    const res = migrateLegacyConfig({
      channels: {
        telegram: {
          groupMentionsOnly: true,
        },
      },
    });

    expect(res).toEqual({ config: null, changes: [] });
  });

  it("does not rewrite removed legacy tts provider shapes", () => {
    const res = migrateLegacyConfig({
      messages: {
        tts: {
          provider: "elevenlabs",
          elevenlabs: {
            apiKey: "test-key",
          },
        },
      },
    });

    expect(res).toEqual({ config: null, changes: [] });
  });

  it("does not rewrite removed x_search auth config", () => {
    const res = migrateLegacyConfig({
      tools: {
        web: {
          x_search: {
            apiKey: "xai-legacy-key",
          },
        },
      },
    });

    expect(res).toEqual({ config: null, changes: [] });
  });

  it("does not seed gateway.controlUi.allowedOrigins anymore", () => {
    const res = migrateLegacyConfig({
      gateway: {
        bind: "lan",
        auth: { mode: "token", token: "tok" },
      },
    });

    expect(res).toEqual({ config: null, changes: [] });
  });

  it("does not rewrite removed top-level heartbeat config", () => {
    const res = migrateLegacyConfig({
      heartbeat: {
        target: "telegram",
      },
    });

    expect(res).toEqual({ config: null, changes: [] });
  });
});
