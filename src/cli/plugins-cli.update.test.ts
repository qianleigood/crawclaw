import { beforeEach, describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { setActiveCliLocale } from "./i18n/index.js";
import {
  loadConfig,
  resetPluginsCliTestState,
  runPluginsCommand,
  runtimeErrors,
  runtimeLogs,
  updateNpmInstalledHookPacks,
  updateNpmInstalledPlugins,
  writeConfigFile,
} from "./plugins-cli-test-helpers.js";

describe("plugins cli update", () => {
  beforeEach(() => {
    resetPluginsCliTestState();
    setActiveCliLocale("en");
  });

  it("updates tracked hook packs through plugins update", async () => {
    const cfg = {
      hooks: {
        internal: {
          installs: {
            "demo-hooks": {
              source: "npm",
              spec: "@acme/demo-hooks@1.0.0",
              installPath: "/tmp/hooks/demo-hooks",
              resolvedName: "@acme/demo-hooks",
            },
          },
        },
      },
    } as CrawClawConfig;
    const nextConfig = {
      hooks: {
        internal: {
          installs: {
            "demo-hooks": {
              source: "npm",
              spec: "@acme/demo-hooks@1.1.0",
              installPath: "/tmp/hooks/demo-hooks",
            },
          },
        },
      },
    } as CrawClawConfig;

    loadConfig.mockReturnValue(cfg);
    updateNpmInstalledPlugins.mockResolvedValue({
      config: cfg,
      changed: false,
      outcomes: [],
    });
    updateNpmInstalledHookPacks.mockResolvedValue({
      config: nextConfig,
      changed: true,
      outcomes: [
        {
          hookId: "demo-hooks",
          status: "updated",
          message: 'Updated hook pack "demo-hooks": 1.0.0 -> 1.1.0.',
        },
      ],
    });

    await runPluginsCommand(["plugins", "update", "demo-hooks"]);

    expect(updateNpmInstalledHookPacks).toHaveBeenCalledWith(
      expect.objectContaining({
        config: cfg,
        hookIds: ["demo-hooks"],
      }),
    );
    expect(writeConfigFile).toHaveBeenCalledWith(nextConfig);
    expect(
      runtimeLogs.some((line) => line.includes("Restart the gateway to load plugins and hooks.")),
    ).toBe(true);
  });

  it("exits when update is called without id and without --all", async () => {
    loadConfig.mockReturnValue({
      plugins: {
        installs: {},
      },
    } as CrawClawConfig);

    await expect(runPluginsCommand(["plugins", "update"])).rejects.toThrow("__exit__:1");

    expect(runtimeErrors.at(-1)).toContain("Provide a plugin or hook-pack id, or use --all.");
    expect(updateNpmInstalledPlugins).not.toHaveBeenCalled();
  });

  it("reports no tracked plugins or hook packs when update --all has empty install records", async () => {
    loadConfig.mockReturnValue({
      plugins: {
        installs: {},
      },
    } as CrawClawConfig);

    await runPluginsCommand(["plugins", "update", "--all"]);

    expect(updateNpmInstalledPlugins).not.toHaveBeenCalled();
    expect(updateNpmInstalledHookPacks).not.toHaveBeenCalled();
    expect(runtimeLogs.at(-1)).toBe("No tracked plugins or hook packs to update.");
  });

  it("localizes update runtime output in zh-CN", async () => {
    setActiveCliLocale("zh-CN");
    loadConfig.mockReturnValue({
      plugins: {
        installs: {},
      },
    } as CrawClawConfig);

    await runPluginsCommand(["plugins", "update", "--all"]);
    await expect(runPluginsCommand(["plugins", "update"])).rejects.toThrow("__exit__:1");

    expect(
      runtimeLogs.some((line) => line.includes("没有已跟踪的 plugins 或 hook packs 可更新。")),
    ).toBe(true);
    expect(runtimeErrors.some((line) => line.includes("请提供 plugin 或 hook-pack id"))).toBe(true);
  });

  it("maps an explicit unscoped npm dist-tag update to the tracked plugin id", async () => {
    const config = {
      plugins: {
        installs: {
          "crawclaw-codex-app-server": {
            source: "npm",
            spec: "crawclaw-codex-app-server",
            installPath: "/tmp/crawclaw-codex-app-server",
            resolvedName: "crawclaw-codex-app-server",
          },
        },
      },
    } as CrawClawConfig;
    loadConfig.mockReturnValue(config);
    updateNpmInstalledPlugins.mockResolvedValue({
      config,
      changed: false,
      outcomes: [],
    });

    await runPluginsCommand(["plugins", "update", "crawclaw-codex-app-server@beta"]);

    expect(updateNpmInstalledPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        pluginIds: ["crawclaw-codex-app-server"],
        specOverrides: {
          "crawclaw-codex-app-server": "crawclaw-codex-app-server@beta",
        },
      }),
    );
  });

  it("maps an explicit scoped npm dist-tag update to the tracked plugin id", async () => {
    const config = {
      plugins: {
        installs: {
          "voice-call": {
            source: "npm",
            spec: "@crawclaw/voice-call",
            installPath: "/tmp/voice-call",
            resolvedName: "@crawclaw/voice-call",
          },
        },
      },
    } as CrawClawConfig;
    loadConfig.mockReturnValue(config);
    updateNpmInstalledPlugins.mockResolvedValue({
      config,
      changed: false,
      outcomes: [],
    });

    await runPluginsCommand(["plugins", "update", "@crawclaw/voice-call@beta"]);

    expect(updateNpmInstalledPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        pluginIds: ["voice-call"],
        specOverrides: {
          "voice-call": "@crawclaw/voice-call@beta",
        },
      }),
    );
  });

  it("maps an explicit npm version update to the tracked plugin id", async () => {
    const config = {
      plugins: {
        installs: {
          "crawclaw-codex-app-server": {
            source: "npm",
            spec: "crawclaw-codex-app-server",
            installPath: "/tmp/crawclaw-codex-app-server",
            resolvedName: "crawclaw-codex-app-server",
          },
        },
      },
    } as CrawClawConfig;
    loadConfig.mockReturnValue(config);
    updateNpmInstalledPlugins.mockResolvedValue({
      config,
      changed: false,
      outcomes: [],
    });

    await runPluginsCommand(["plugins", "update", "crawclaw-codex-app-server@0.2.0-beta.4"]);

    expect(updateNpmInstalledPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        pluginIds: ["crawclaw-codex-app-server"],
        specOverrides: {
          "crawclaw-codex-app-server": "crawclaw-codex-app-server@0.2.0-beta.4",
        },
      }),
    );
  });

  it("keeps using the recorded npm tag when update is invoked by plugin id", async () => {
    const config = {
      plugins: {
        installs: {
          "crawclaw-codex-app-server": {
            source: "npm",
            spec: "crawclaw-codex-app-server@beta",
            installPath: "/tmp/crawclaw-codex-app-server",
            resolvedName: "crawclaw-codex-app-server",
          },
        },
      },
    } as CrawClawConfig;
    loadConfig.mockReturnValue(config);
    updateNpmInstalledPlugins.mockResolvedValue({
      config,
      changed: false,
      outcomes: [],
    });

    await runPluginsCommand(["plugins", "update", "crawclaw-codex-app-server"]);

    expect(updateNpmInstalledPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        pluginIds: ["crawclaw-codex-app-server"],
      }),
    );
    expect(updateNpmInstalledPlugins).not.toHaveBeenCalledWith(
      expect.objectContaining({
        specOverrides: expect.anything(),
      }),
    );
  });

  it("writes updated config when updater reports changes", async () => {
    const cfg = {
      plugins: {
        installs: {
          alpha: {
            source: "npm",
            spec: "@crawclaw/alpha@1.0.0",
          },
        },
      },
    } as CrawClawConfig;
    const nextConfig = {
      plugins: {
        installs: {
          alpha: {
            source: "npm",
            spec: "@crawclaw/alpha@1.1.0",
          },
        },
      },
    } as CrawClawConfig;
    loadConfig.mockReturnValue(cfg);
    updateNpmInstalledPlugins.mockResolvedValue({
      outcomes: [{ status: "ok", message: "Updated alpha -> 1.1.0" }],
      changed: true,
      config: nextConfig,
    });
    updateNpmInstalledHookPacks.mockResolvedValue({
      outcomes: [],
      changed: false,
      config: nextConfig,
    });

    await runPluginsCommand(["plugins", "update", "alpha"]);

    expect(updateNpmInstalledPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        config: cfg,
        pluginIds: ["alpha"],
        dryRun: false,
      }),
    );
    expect(writeConfigFile).toHaveBeenCalledWith(nextConfig);
    expect(
      runtimeLogs.some((line) => line.includes("Restart the gateway to load plugins and hooks.")),
    ).toBe(true);
  });
});
