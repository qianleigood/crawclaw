import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoInstallSpec } from "../../test/helpers/bundled-plugin-paths.js";
import { withTempHome } from "../../test/helpers/temp-home.js";
import {
  detectPluginInstallPathIssue,
  formatPluginInstallPathIssue,
} from "./plugin-install-path-warnings.js";

async function detectFeishuCustomPathIssue(sourcePath: string | ((pluginPath: string) => string)) {
  return withTempHome(async (home) => {
    const pluginPath = path.join(home, "feishu-plugin");
    await fs.mkdir(pluginPath, { recursive: true });
    const resolvedSourcePath =
      typeof sourcePath === "function" ? sourcePath(pluginPath) : sourcePath;
    const issue = await detectPluginInstallPathIssue({
      pluginId: "feishu",
      install: {
        source: "path",
        sourcePath: resolvedSourcePath,
        installPath: pluginPath,
      },
    });

    return { issue, pluginPath };
  });
}

const MATRIX_REPO_INSTALL_COMMAND = `crawclaw plugins install ${repoInstallSpec("feishu")}`;

describe("plugin install path warnings", () => {
  it("ignores non-path installs and blank path candidates", async () => {
    expect(
      await detectPluginInstallPathIssue({
        pluginId: "feishu",
        install: null,
      }),
    ).toBeNull();
    expect(
      await detectPluginInstallPathIssue({
        pluginId: "feishu",
        install: {
          source: "npm",
          sourcePath: " ",
          installPath: " ",
        },
      }),
    ).toBeNull();
  });

  it("detects stale custom plugin install paths", async () => {
    const issue = await detectPluginInstallPathIssue({
      pluginId: "feishu",
      install: {
        source: "path",
        sourcePath: "/tmp/crawclaw-feishu-missing",
        installPath: "/tmp/crawclaw-feishu-missing",
      },
    });

    expect(issue).toEqual({
      kind: "missing-path",
      pluginId: "feishu",
      path: "/tmp/crawclaw-feishu-missing",
    });
    expect(
      formatPluginInstallPathIssue({
        issue: issue!,
        pluginLabel: "Feishu",
        defaultInstallCommand: "crawclaw plugins install @crawclaw/feishu",
        repoInstallCommand: MATRIX_REPO_INSTALL_COMMAND,
      }),
    ).toEqual([
      "Feishu is installed from a custom path that no longer exists: /tmp/crawclaw-feishu-missing",
      'Reinstall with "crawclaw plugins install @crawclaw/feishu".',
      `If you are running from a repo checkout, you can also use "${MATRIX_REPO_INSTALL_COMMAND}".`,
    ]);
  });

  it("uses the second candidate path when the first one is stale", async () => {
    const { issue, pluginPath } = await detectFeishuCustomPathIssue("/tmp/crawclaw-feishu-missing");
    expect(issue).toEqual({
      kind: "custom-path",
      pluginId: "feishu",
      path: pluginPath,
    });
  });

  it("detects active custom plugin install paths", async () => {
    const { issue, pluginPath } = await detectFeishuCustomPathIssue(
      (resolvedPluginPath) => resolvedPluginPath,
    );
    expect(issue).toEqual({
      kind: "custom-path",
      pluginId: "feishu",
      path: pluginPath,
    });
  });

  it("applies custom command formatting in warning messages", () => {
    expect(
      formatPluginInstallPathIssue({
        issue: {
          kind: "custom-path",
          pluginId: "feishu",
          path: "/tmp/feishu-plugin",
        },
        pluginLabel: "Feishu",
        defaultInstallCommand: "crawclaw plugins install @crawclaw/feishu",
        repoInstallCommand: MATRIX_REPO_INSTALL_COMMAND,
        formatCommand: (command) => `<${command}>`,
      }),
    ).toEqual([
      "Feishu is installed from a custom path: /tmp/feishu-plugin",
      "Main updates will not automatically replace that plugin with the repo's default Feishu package.",
      'Reinstall with "<crawclaw plugins install @crawclaw/feishu>" when you want to return to the standard Feishu plugin.',
      `If you are intentionally running from a repo checkout, reinstall that checkout explicitly with "<${MATRIX_REPO_INSTALL_COMMAND}>" after updates.`,
    ]);
  });

  it("omits repo checkout guidance when no bundled source hint exists", () => {
    expect(
      formatPluginInstallPathIssue({
        issue: {
          kind: "missing-path",
          pluginId: "feishu",
          path: "/tmp/crawclaw-feishu-missing",
        },
        pluginLabel: "Feishu",
        defaultInstallCommand: "crawclaw plugins install @crawclaw/feishu",
        repoInstallCommand: null,
      }),
    ).toEqual([
      "Feishu is installed from a custom path that no longer exists: /tmp/crawclaw-feishu-missing",
      'Reinstall with "crawclaw plugins install @crawclaw/feishu".',
    ]);
  });
});
