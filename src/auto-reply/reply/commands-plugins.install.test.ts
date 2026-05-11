import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "../../config/home-env.test-harness.js";
import { handleCommands } from "./commands-core.js";
import { createCommandWorkspaceHarness } from "./commands-filesystem.test-support.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

const installPluginWithRustLifecycleMock = vi.fn();

vi.mock("../../plugins/rust-lifecycle.js", () => ({
  installPluginWithRustLifecycle: (...args: unknown[]) =>
    installPluginWithRustLifecycleMock(...args),
}));

const workspaceHarness = createCommandWorkspaceHarness("crawclaw-command-plugins-install-");

describe("handleCommands /plugins install", () => {
  afterEach(async () => {
    installPluginWithRustLifecycleMock.mockReset();
    await workspaceHarness.cleanupWorkspaces();
  });

  it("installs a plugin from a local path", async () => {
    installPluginWithRustLifecycleMock.mockResolvedValue({
      ok: true,
      value: {
        pluginId: "path-install-plugin",
      },
    });

    await withTempHome("crawclaw-command-plugins-home-", async () => {
      const workspaceDir = await workspaceHarness.createWorkspace();
      const pluginDir = path.join(workspaceDir, "fixtures", "path-install-plugin");
      await fs.mkdir(pluginDir, { recursive: true });

      const params = buildCommandTestParams(
        `/plugins install ${pluginDir}`,
        {
          commands: {
            text: true,
            plugins: true,
          },
        },
        undefined,
        { workspaceDir },
      );
      params.command.senderIsOwner = true;

      const result = await handleCommands(params);
      expect(result.reply?.text).toContain('Installed plugin "path-install-plugin"');
      expect(installPluginWithRustLifecycleMock).toHaveBeenCalledWith(
        expect.objectContaining({ raw: pluginDir }),
      );
    });
  });

  it("installs from an explicit clawhub: spec", async () => {
    installPluginWithRustLifecycleMock.mockResolvedValue({
      ok: true,
      value: {
        pluginId: "clawhub-demo",
      },
    });

    await withTempHome("crawclaw-command-plugins-home-", async () => {
      const workspaceDir = await workspaceHarness.createWorkspace();
      const params = buildCommandTestParams(
        "/plugins install clawhub:@crawclaw/clawhub-demo@1.2.3",
        {
          commands: {
            text: true,
            plugins: true,
          },
        },
        undefined,
        { workspaceDir },
      );
      params.command.senderIsOwner = true;

      const result = await handleCommands(params);
      expect(result.reply?.text).toContain('Installed plugin "clawhub-demo"');
      expect(installPluginWithRustLifecycleMock).toHaveBeenCalledWith(
        expect.objectContaining({ raw: "clawhub:@crawclaw/clawhub-demo@1.2.3" }),
      );
    });
  });

  it("treats /plugin add as an install alias", async () => {
    installPluginWithRustLifecycleMock.mockResolvedValue({
      ok: true,
      value: {
        pluginId: "alias-demo",
      },
    });

    await withTempHome("crawclaw-command-plugins-home-", async () => {
      const workspaceDir = await workspaceHarness.createWorkspace();
      const params = buildCommandTestParams(
        "/plugin add clawhub:@crawclaw/alias-demo@1.0.0",
        {
          commands: {
            text: true,
            plugins: true,
          },
        },
        undefined,
        { workspaceDir },
      );
      params.command.senderIsOwner = true;

      const result = await handleCommands(params);
      expect(result.reply?.text).toContain('Installed plugin "alias-demo"');
      expect(installPluginWithRustLifecycleMock).toHaveBeenCalledWith(
        expect.objectContaining({ raw: "clawhub:@crawclaw/alias-demo@1.0.0" }),
      );
    });
  });
});
