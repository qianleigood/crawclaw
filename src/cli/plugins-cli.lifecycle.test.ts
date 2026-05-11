import { beforeEach, describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import {
  installPluginWithRustLifecycle,
  loadConfig,
  replaceConfigFile,
  resetPluginsCliTestState,
  runPluginsCommand,
  updatePluginsWithRustLifecycle,
  writeConfigFile,
} from "./plugins-cli-test-helpers.js";

describe("plugins CLI lifecycle wrappers", () => {
  beforeEach(() => {
    resetPluginsCliTestState();
  });

  it("installs plugins through the Rust lifecycle helper", async () => {
    const baseConfig: CrawClawConfig = { plugins: { allow: ["demo"] } };
    const installedConfig: CrawClawConfig = {
      plugins: {
        allow: ["demo"],
        entries: {
          demo: { enabled: true },
        },
        installs: {
          demo: {
            source: "npm",
            spec: "@crawclaw/demo",
            installPath: "/tmp/demo",
          },
        },
      },
    };
    loadConfig.mockReturnValue(baseConfig);
    installPluginWithRustLifecycle.mockResolvedValue({
      ok: true,
      value: {
        pluginId: "demo",
      },
      config: installedConfig,
    });

    await runPluginsCommand(["plugins", "install", "@crawclaw/demo"]);

    expect(installPluginWithRustLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        raw: "@crawclaw/demo",
        config: baseConfig,
      }),
    );
    expect(writeConfigFile).toHaveBeenCalledWith(installedConfig);
  });

  it("updates tracked plugins through the Rust lifecycle helper", async () => {
    const baseConfig: CrawClawConfig = {
      plugins: {
        installs: {
          demo: {
            source: "npm",
            spec: "@crawclaw/demo",
            installPath: "/tmp/demo",
          },
        },
      },
    };
    const updatedConfig: CrawClawConfig = {
      plugins: {
        installs: {
          demo: {
            source: "npm",
            spec: "@crawclaw/demo@2.0.0",
            installPath: "/tmp/demo",
          },
        },
      },
    };
    loadConfig.mockReturnValue(baseConfig);
    updatePluginsWithRustLifecycle.mockResolvedValue({
      ok: true,
      value: {
        changed: true,
        outcomes: [
          {
            pluginId: "demo",
            status: "updated",
            message: 'Updated "demo".',
          },
        ],
      },
      config: updatedConfig,
    });

    await runPluginsCommand(["plugins", "update", "demo"]);

    expect(updatePluginsWithRustLifecycle).toHaveBeenCalledWith({
      id: "demo",
      dryRun: false,
      config: baseConfig,
    });
    expect(replaceConfigFile).toHaveBeenCalledWith({
      nextConfig: updatedConfig,
      baseHash: "mock",
    });
  });
});
