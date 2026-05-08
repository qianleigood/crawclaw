import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertAdminDesktopReleaseInputs } from "../../scripts/admin-desktop-release-check.mjs";

describe("admin desktop release check", () => {
  function createReleaseFixture() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-admin-desktop-release-"));
    fs.mkdirSync(path.join(rootDir, "apps", "crawclaw-admin", "dist"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "apps", "crawclaw-admin-desktop", ".runtime", "crawclaw"), {
      recursive: true,
    });
    fs.mkdirSync(
      path.join(
        rootDir,
        "apps",
        "crawclaw-admin-desktop",
        ".runtime",
        "crawclaw",
        "node_modules",
        "chalk",
      ),
      { recursive: true },
    );
    fs.mkdirSync(
      path.join(rootDir, "apps", "crawclaw-admin-desktop", ".runtime", "crawclaw", "bin"),
      {
        recursive: true,
      },
    );
    fs.mkdirSync(
      path.join(
        rootDir,
        "apps",
        "crawclaw-admin-desktop",
        ".runtime",
        "crawclaw",
        "runtimes",
        "node-24",
        "scrapling-fetch",
        "venv",
        "bin",
      ),
      {
        recursive: true,
      },
    );
    fs.mkdirSync(
      path.join(
        rootDir,
        "apps",
        "crawclaw-admin-desktop",
        ".runtime",
        "crawclaw",
        "runtimes",
        "node-24",
        "notebooklm-mcp-cli",
        "venv",
        "bin",
      ),
      {
        recursive: true,
      },
    );
    fs.writeFileSync(path.join(rootDir, "package.json"), '{"version":"2026.5.8"}\n', "utf8");
    fs.writeFileSync(
      path.join(rootDir, "apps", "crawclaw-admin-desktop", "package.json"),
      '{"version":"2026.5.8"}\n',
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootDir, "apps", "crawclaw-admin-desktop", "electron-builder.yml"),
      [
        "appId: ai.crawclaw.desktop",
        "productName: CrawClaw Desktop",
        "mac:",
        "  target:",
        "    - dmg",
        "    - zip",
        "win:",
        "  target:",
        "    - nsis",
        "linux:",
        "  target:",
        "    - AppImage",
        "extraResources:",
        "  - from: .runtime/crawclaw",
        "    to: runtime/crawclaw",
        "  - from: .runtime/crawclaw/node_modules",
        "    to: runtime/crawclaw/node_modules",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootDir, "apps", "crawclaw-admin", "dist", "index.html"),
      "",
      "utf8",
    );
    const runtimeEntryPath = path.join(
      rootDir,
      "apps",
      "crawclaw-admin-desktop",
      ".runtime",
      "crawclaw",
      "crawclaw.mjs",
    );
    fs.writeFileSync(runtimeEntryPath, "#!/usr/bin/env node\n", "utf8");
    fs.chmodSync(runtimeEntryPath, 0o755);
    const nodePath = path.join(
      rootDir,
      "apps",
      "crawclaw-admin-desktop",
      ".runtime",
      "crawclaw",
      "bin",
      process.platform === "win32" ? "node.exe" : "node",
    );
    fs.writeFileSync(nodePath, "#!/usr/bin/env node\n", "utf8");
    fs.chmodSync(nodePath, 0o755);
    fs.writeFileSync(
      path.join(
        rootDir,
        "apps",
        "crawclaw-admin-desktop",
        ".runtime",
        "crawclaw",
        "node_modules",
        "chalk",
        "package.json",
      ),
      "{}\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(
        rootDir,
        "apps",
        "crawclaw-admin-desktop",
        ".runtime",
        "crawclaw",
        "runtimes",
        "manifest.json",
      ),
      "{}\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(
        rootDir,
        "apps",
        "crawclaw-admin-desktop",
        ".runtime",
        "crawclaw",
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
        rootDir,
        "apps",
        "crawclaw-admin-desktop",
        ".runtime",
        "crawclaw",
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
    return rootDir;
  }

  function runtimeEntryPath(rootDir: string) {
    return path.join(
      rootDir,
      "apps",
      "crawclaw-admin-desktop",
      ".runtime",
      "crawclaw",
      "crawclaw.mjs",
    );
  }

  function nodePath(rootDir: string) {
    return path.join(
      rootDir,
      "apps",
      "crawclaw-admin-desktop",
      ".runtime",
      "crawclaw",
      "bin",
      process.platform === "win32" ? "node.exe" : "node",
    );
  }

  it("requires CrawClaw Desktop branding and the embedded runtime entrypoint", () => {
    expect(() =>
      assertAdminDesktopReleaseInputs({
        rootDir: createReleaseFixture(),
        checkGeneratedPaths: false,
      }),
    ).not.toThrow();
  });

  it("smokes the embedded runtime help commands", () => {
    const rootDir = createReleaseFixture();
    const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];

    assertAdminDesktopReleaseInputs({
      rootDir,
      checkGeneratedPaths: false,
      spawnSyncImpl(command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) {
        calls.push({ command, args, env: options?.env });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls.map((call) => ({ command: call.command, args: call.args }))).toEqual([
      {
        command: nodePath(rootDir),
        args: [runtimeEntryPath(rootDir), "gateway", "--help"],
      },
      {
        command: nodePath(rootDir),
        args: [runtimeEntryPath(rootDir), "gateway", "run", "--allow-unconfigured", "--help"],
      },
    ]);
    expect(calls[0]?.env?.CRAWCLAW_STATE_DIR).toMatch(/crawclaw-desktop-release-smoke-/);
    expect(calls[0]?.env?.CRAWCLAW_PLUGIN_RUNTIMES_DIR).toBe(
      path.join(rootDir, "apps", "crawclaw-admin-desktop", ".runtime", "crawclaw", "runtimes"),
    );
  });

  it("fails when the embedded runtime entrypoint is missing", () => {
    const rootDir = createReleaseFixture();
    fs.rmSync(runtimeEntryPath(rootDir), { force: true });

    expect(() =>
      assertAdminDesktopReleaseInputs({
        rootDir,
        checkGeneratedPaths: false,
      }),
    ).toThrow(/embedded CrawClaw runtime entrypoint/);
  });
});
