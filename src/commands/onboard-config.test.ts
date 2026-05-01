import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import {
  applyLocalSetupWorkspaceConfig,
  ONBOARDING_DEFAULT_DM_SCOPE,
  ONBOARDING_DEFAULT_TOOLS_PROFILE,
} from "./onboard-config.js";

const designedDefaultMainTools = [
  "browser",
  "memory_manifest_read",
  "memory_note_read",
  "memory_note_write",
  "memory_note_edit",
  "memory_note_delete",
  "write_experience_note",
];

describe("applyLocalSetupWorkspaceConfig", () => {
  it("defaults local setup tool profile to coding", () => {
    expect(ONBOARDING_DEFAULT_TOOLS_PROFILE).toBe("coding");
  });

  it("sets secure dmScope default when unset", () => {
    const baseConfig: CrawClawConfig = {};
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.session?.dmScope).toBe(ONBOARDING_DEFAULT_DM_SCOPE);
    expect(result.gateway?.mode).toBe("local");
    expect(result.agents?.defaults?.workspace).toBe("/tmp/workspace");
    expect(result.tools?.profile).toBe(ONBOARDING_DEFAULT_TOOLS_PROFILE);
  });

  it("allows designed default tools on the default main agent", () => {
    const result = applyLocalSetupWorkspaceConfig({}, "/tmp/workspace");

    expect(result.agents?.list).toEqual([
      {
        id: "main",
        tools: {
          alsoAllow: designedDefaultMainTools,
        },
      },
    ]);
  });

  it("merges designed default tools into an existing main agent additive tool policy", () => {
    const baseConfig: CrawClawConfig = {
      agents: {
        list: [
          {
            id: "main",
            name: "Main",
            tools: {
              alsoAllow: ["tts"],
            },
          },
        ],
      },
    };
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.agents?.list?.[0]).toEqual({
      id: "main",
      name: "Main",
      tools: {
        alsoAllow: ["tts", ...designedDefaultMainTools],
      },
    });
  });

  it("does not default special-agent-only memory maintenance tools to main", () => {
    const result = applyLocalSetupWorkspaceConfig({}, "/tmp/workspace");
    const alsoAllow = result.agents?.list?.[0]?.tools?.alsoAllow ?? [];

    expect(alsoAllow).not.toContain("memory_transcript_search");
    expect(alsoAllow).not.toContain("session_summary_file_read");
    expect(alsoAllow).not.toContain("session_summary_file_edit");
    expect(alsoAllow).not.toContain("submit_promotion_verdict");
  });

  it("preserves existing dmScope when already configured", () => {
    const baseConfig: CrawClawConfig = {
      session: {
        dmScope: "main",
      },
    };
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.session?.dmScope).toBe("main");
  });

  it("preserves explicit non-main dmScope values", () => {
    const baseConfig: CrawClawConfig = {
      session: {
        dmScope: "per-account-channel-peer",
      },
    };
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.session?.dmScope).toBe("per-account-channel-peer");
  });

  it("preserves an explicit tools.profile when already configured", () => {
    const baseConfig: CrawClawConfig = {
      tools: {
        profile: "full",
      },
    };
    const result = applyLocalSetupWorkspaceConfig(baseConfig, "/tmp/workspace");

    expect(result.tools?.profile).toBe("full");
  });
});
