import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __testing } from "./daemon.js";

const tempRoots: string[] = [];
const originalStateDir = process.env.CRAWCLAW_STATE_DIR;

function makeRuntimeBin(): { stateDir: string; binPath: string; entrypoint: string } {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-open-websearch-"));
  tempRoots.push(stateDir);
  const packageRoot = path.join(
    stateDir,
    "runtimes",
    "open-websearch",
    "node_modules",
    "open-websearch",
  );
  const entrypoint = path.join(packageRoot, "dist", "cli.js");
  const binPath =
    process.platform === "win32"
      ? path.join(
          stateDir,
          "runtimes",
          "open-websearch",
          "node_modules",
          ".bin",
          "open-websearch.cmd",
        )
      : path.join(stateDir, "runtimes", "open-websearch", "node_modules", ".bin", "open-websearch");
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
  fs.writeFileSync(binPath, "", "utf8");
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ bin: { "open-websearch": "dist/cli.js" } }),
    "utf8",
  );
  fs.writeFileSync(entrypoint, "", "utf8");
  return { stateDir, binPath, entrypoint };
}

afterEach(() => {
  if (originalStateDir === undefined) {
    delete process.env.CRAWCLAW_STATE_DIR;
  } else {
    process.env.CRAWCLAW_STATE_DIR = originalStateDir;
  }
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("open-websearch daemon runtime resolution", () => {
  it("uses the managed runtime under CRAWCLAW_STATE_DIR", () => {
    const { stateDir, binPath, entrypoint } = makeRuntimeBin();
    const expected =
      process.platform === "win32"
        ? { command: process.execPath, args: [entrypoint], windowsHide: true }
        : { command: binPath, args: [] };
    expect(__testing.resolveLaunchCommand({ CRAWCLAW_STATE_DIR: stateDir })).toEqual(expected);
  });

  it("resolves the Windows cmd shim to the package Node entrypoint", () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const { stateDir, binPath } = makeRuntimeBin();
    const entrypoint = path.join(
      stateDir,
      "runtimes",
      "open-websearch",
      "node_modules",
      "open-websearch",
      "dist",
      "cli.js",
    );

    try {
      expect(__testing.resolveLaunchCommand({ CRAWCLAW_STATE_DIR: stateDir })).toMatchObject({
        command: process.execPath,
        args: [entrypoint],
        windowsHide: true,
      });
      expect(binPath.endsWith("open-websearch.cmd")).toBe(true);
    } finally {
      platformSpy.mockRestore();
    }
  });
});
