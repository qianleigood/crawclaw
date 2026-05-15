import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import {
  applyLocalSetupWorkspaceConfig,
  ONBOARDING_DEFAULT_DM_SCOPE,
  ONBOARDING_DEFAULT_TOOLS_PROFILE,
} from "./onboard-config.js";

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

  it("does not create a main agent tool override for local setup", () => {
    const result = applyLocalSetupWorkspaceConfig({}, "/tmp/workspace");

    expect(result.agents?.list).toBeUndefined();
  });

  it("preserves existing main agent additive tool policy without injecting defaults", () => {
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
        alsoAllow: ["tts"],
      },
    });
  });

  it("does not create a main agent override for memory maintenance tools", () => {
    const result = applyLocalSetupWorkspaceConfig({}, "/tmp/workspace");

    expect(result.agents?.list).toBeUndefined();
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
