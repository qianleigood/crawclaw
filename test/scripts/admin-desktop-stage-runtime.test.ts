import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveAdminDesktopRuntimeStagePaths,
  resolveStableNodePath,
  stageAdminDesktopRuntime,
} from "../../scripts/admin-desktop-stage-runtime.mjs";

describe("admin desktop runtime staging", () => {
  it("builds and deploys the root CrawClaw runtime into desktop extraResources", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-admin-desktop-runtime-"));
    const paths = resolveAdminDesktopRuntimeStagePaths(rootDir);
    const sourceNodePath = path.join(rootDir, "node");
    fs.mkdirSync(paths.runtimeRoot, { recursive: true });
    fs.writeFileSync(path.join(paths.runtimeRoot, "stale.txt"), "stale\n", "utf8");
    fs.writeFileSync(sourceNodePath, "#!/usr/bin/env node\n", "utf8");

    const calls: Array<{ cwd: string; command: string; args: string[]; env?: NodeJS.ProcessEnv }> =
      [];
    stageAdminDesktopRuntime({
      rootDir,
      env: {
        PATH: "/usr/bin",
        CRAWCLAW_DESKTOP_RUNTIME_NODE_PATH: sourceNodePath,
      },
      runCommand({ cwd, command, args, env }) {
        calls.push({ cwd, command, args, env });
        if (args.includes("-p")) {
          return { status: 0, signal: null, stdout: "24\n", stderr: "" };
        }
        if (args.includes("deploy")) {
          fs.mkdirSync(path.join(paths.runtimeRoot, "dist"), { recursive: true });
          fs.mkdirSync(
            path.join(paths.runtimeRoot, "runtimes", "node-24", "scrapling-fetch", "venv", "bin"),
            { recursive: true },
          );
          fs.mkdirSync(
            path.join(
              paths.runtimeRoot,
              "runtimes",
              "node-24",
              "notebooklm-mcp-cli",
              "venv",
              "bin",
            ),
            { recursive: true },
          );
          fs.writeFileSync(paths.runtimeEntryPath, "#!/usr/bin/env node\n", "utf8");
          fs.writeFileSync(path.join(paths.runtimeRoot, "dist", "index.js"), "", "utf8");
          fs.writeFileSync(
            path.join(paths.runtimeRoot, "runtimes", "manifest.json"),
            "{}\n",
            "utf8",
          );
          fs.writeFileSync(
            path.join(
              paths.runtimeRoot,
              "runtimes",
              "node-24",
              "scrapling-fetch",
              "venv",
              "bin",
              "python",
            ),
            "",
            "utf8",
          );
          fs.writeFileSync(
            path.join(
              paths.runtimeRoot,
              "runtimes",
              "node-24",
              "notebooklm-mcp-cli",
              "venv",
              "bin",
              "notebooklm-mcp",
            ),
            "",
            "utf8",
          );
        }
        return { status: 0, signal: null, stdout: "", stderr: "" };
      },
    });

    expect(
      calls.map((call) => ({ cwd: call.cwd, command: call.command, args: call.args })),
    ).toEqual([
      {
        cwd: rootDir,
        command: sourceNodePath,
        args: ["-p", "process.versions.node.split('.')[0]"],
      },
      { cwd: rootDir, command: "pnpm", args: ["build"] },
      {
        cwd: rootDir,
        command: "pnpm",
        args: ["--filter", "crawclaw", "deploy", paths.runtimeRoot, "--prod", "--legacy"],
      },
    ]);
    expect(calls.at(-1)?.env?.PATH?.startsWith(`${rootDir}:`)).toBe(true);
    expect(calls.at(-1)?.env?.CRAWCLAW_RUNTIME_NODE_VERSION).toBe("24");
    expect(calls.at(-1)?.env?.CRAWCLAW_STATE_DIR).toBe(paths.runtimeRoot);
    expect(calls.at(-1)?.env?.CRAWCLAW_PLUGIN_RUNTIMES_DIR).toBe(
      path.join(paths.runtimeRoot, "runtimes"),
    );
    expect(calls.at(-1)?.env?.CRAWCLAW_RUNTIME_INSTALL_PROFILE).toBe("desktop-core");
    expect(fs.existsSync(path.join(paths.runtimeRoot, "stale.txt"))).toBe(false);
    expect(fs.existsSync(paths.runtimeEntryPath)).toBe(true);
    expect(fs.existsSync(paths.nodePath)).toBe(true);
    expect(fs.existsSync(path.join(paths.runtimeRoot, "runtimes", "node-24", "n8n"))).toBe(false);
  });

  it("uses an explicit Node 24 runtime binary when the shell default is newer", () => {
    const nodePath = resolveStableNodePath({
      env: { CRAWCLAW_DESKTOP_RUNTIME_NODE_PATH: "/usr/local/bin/node" },
      runCommand({ command }) {
        expect(command).toBe("/usr/local/bin/node");
        return { status: 0, signal: null, stdout: "24\n", stderr: "" };
      },
    });

    expect(nodePath).toBe("/usr/local/bin/node");
  });
});
