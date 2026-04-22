import type { CrawClawConfig } from "crawclaw/plugin-sdk/config-runtime";
import { describe, expect, it } from "vitest";
import { resolveDiscordDraftStreamingChunking } from "./draft-chunking.js";

describe("resolveDiscordDraftStreamingChunking", () => {
  it("returns sane defaults when discord draft chunking is unset", () => {
    expect(resolveDiscordDraftStreamingChunking(undefined)).toEqual({
      minChars: 200,
      maxChars: 800,
      breakPreference: "paragraph",
    });
  });

  it("clamps defaults to the resolved text limit", () => {
    const cfg = {
      channels: {
        discord: {
          textChunkLimit: 500,
        },
      },
    } as CrawClawConfig;

    expect(resolveDiscordDraftStreamingChunking(cfg)).toEqual({
      minChars: 200,
      maxChars: 500,
      breakPreference: "paragraph",
    });
  });
});
