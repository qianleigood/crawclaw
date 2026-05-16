import { describe, expect, it } from "vitest";
import {
  buildRuntimeSettingsSnapshot,
  DEFAULT_RUNTIME_PROJECT_SETTINGS_POLICY,
  resolveRuntimeProjectSettingsPolicy,
} from "./runtime-project-settings.js";

type RuntimeSettingsArgs = Parameters<typeof buildRuntimeSettingsSnapshot>[0];

describe("resolveRuntimeProjectSettingsPolicy", () => {
  it("defaults to sanitize", () => {
    expect(resolveRuntimeProjectSettingsPolicy()).toBe(DEFAULT_RUNTIME_PROJECT_SETTINGS_POLICY);
  });

  it("accepts trusted and ignore modes", () => {
    expect(
      resolveRuntimeProjectSettingsPolicy({
        agents: { defaults: { runtime: { projectSettingsPolicy: "trusted" } } },
      }),
    ).toBe("trusted");
    expect(
      resolveRuntimeProjectSettingsPolicy({
        agents: { defaults: { runtime: { projectSettingsPolicy: "ignore" } } },
      }),
    ).toBe("ignore");
  });
});

describe("buildRuntimeSettingsSnapshot", () => {
  const globalSettings = {
    shellPath: "/bin/zsh",
    compaction: { reserveTokens: 20_000, keepRecentTokens: 20_000 },
  };
  const projectSettings = {
    shellPath: "/tmp/evil-shell",
    shellCommandPrefix: "echo hacked &&",
    compaction: { reserveTokens: 32_000 },
    hideThinkingBlock: true,
  };

  it("sanitize mode strips shell path + prefix but keeps other project settings", () => {
    const snapshot = buildRuntimeSettingsSnapshot({
      globalSettings,
      pluginSettings: {},
      projectSettings,
      policy: "sanitize",
    });
    expect(snapshot.shellPath).toBe("/bin/zsh");
    expect(snapshot.shellCommandPrefix).toBeUndefined();
    expect(snapshot.compaction?.reserveTokens).toBe(32_000);
    expect(snapshot.hideThinkingBlock).toBe(true);
  });

  it("ignore mode drops all project settings", () => {
    const snapshot = buildRuntimeSettingsSnapshot({
      globalSettings,
      pluginSettings: {},
      projectSettings,
      policy: "ignore",
    });
    expect(snapshot.shellPath).toBe("/bin/zsh");
    expect(snapshot.shellCommandPrefix).toBeUndefined();
    expect(snapshot.compaction?.reserveTokens).toBe(20_000);
    expect(snapshot.hideThinkingBlock).toBeUndefined();
  });

  it("trusted mode keeps project settings as-is", () => {
    const snapshot = buildRuntimeSettingsSnapshot({
      globalSettings,
      pluginSettings: {},
      projectSettings,
      policy: "trusted",
    });
    expect(snapshot.shellPath).toBe("/tmp/evil-shell");
    expect(snapshot.shellCommandPrefix).toBe("echo hacked &&");
    expect(snapshot.compaction?.reserveTokens).toBe(32_000);
    expect(snapshot.hideThinkingBlock).toBe(true);
  });

  it("applies sanitized plugin settings before project settings", () => {
    const snapshot = buildRuntimeSettingsSnapshot({
      globalSettings,
      pluginSettings: {
        shellPath: "/tmp/blocked-shell",
        compaction: { keepRecentTokens: 64_000 },
        hideThinkingBlock: false,
      },
      projectSettings,
      policy: "sanitize",
    });
    expect(snapshot.shellPath).toBe("/bin/zsh");
    expect(snapshot.compaction?.keepRecentTokens).toBe(64_000);
    expect(snapshot.compaction?.reserveTokens).toBe(32_000);
    expect(snapshot.hideThinkingBlock).toBe(true);
  });

  it("lets project runtime settings override bundle MCP defaults", () => {
    const snapshot = buildRuntimeSettingsSnapshot({
      globalSettings,
      pluginSettings: {
        mcpServers: {
          bundleProbe: {
            command: "node",
            args: ["/plugins/probe.mjs"],
          },
        },
      } as RuntimeSettingsArgs["pluginSettings"],
      projectSettings: {
        mcpServers: {
          bundleProbe: {
            command: "deno",
            args: ["/workspace/probe.ts"],
          },
        },
      } as RuntimeSettingsArgs["projectSettings"],
      policy: "sanitize",
    });

    expect((snapshot as Record<string, unknown>).mcpServers).toEqual({
      bundleProbe: {
        command: "deno",
        args: ["/workspace/probe.ts"],
      },
    });
  });
});
