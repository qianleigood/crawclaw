import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { enablePluginInConfig } from "./enable.js";

function expectEnableResult(
  cfg: CrawClawConfig,
  pluginId: string,
  params: {
    enabled: boolean;
    assert: (result: ReturnType<typeof enablePluginInConfig>) => void;
  },
) {
  const result = enablePluginInConfig(cfg, pluginId);
  expect(result.enabled).toBe(params.enabled);
  params.assert(result);
}

function expectEnabledAllowlist(
  result: ReturnType<typeof enablePluginInConfig>,
  expected: string[],
) {
  expect(result.config.plugins?.allow).toEqual(expected);
}

describe("enablePluginInConfig", () => {
  it.each([
    {
      name: "enables a plugin entry",
      cfg: {} as CrawClawConfig,
      pluginId: "google",
      expectedEnabled: true,
      assert: (result: ReturnType<typeof enablePluginInConfig>) => {
        expect(result.config.plugins?.entries?.google?.enabled).toBe(true);
      },
    },
    {
      name: "adds plugin to allowlist when allowlist is configured",
      cfg: {
        plugins: {
          allow: ["legacy-memory"],
        },
      } as CrawClawConfig,
      pluginId: "google",
      expectedEnabled: true,
      assert: (result: ReturnType<typeof enablePluginInConfig>) => {
        expectEnabledAllowlist(result, ["legacy-memory", "google"]);
      },
    },
    {
      name: "refuses enable when plugin is denylisted",
      cfg: {
        plugins: {
          deny: ["google"],
        },
      } as CrawClawConfig,
      pluginId: "google",
      expectedEnabled: false,
      assert: (result: ReturnType<typeof enablePluginInConfig>) => {
        expect(result.reason).toBe("blocked by denylist");
      },
    },
  ])("$name", ({ cfg, pluginId, expectedEnabled, assert }) => {
    expectEnableResult(cfg, pluginId, {
      enabled: expectedEnabled,
      assert,
    });
  });
});
