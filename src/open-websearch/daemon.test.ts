import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __testing } from "./daemon.js";

const tempRoots: string[] = [];
const originalStateDir = process.env.CRAWCLAW_STATE_DIR;

function makeRuntimeBin(): { stateDir: string; binPath: string } {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-open-websearch-"));
  tempRoots.push(stateDir);
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
  fs.writeFileSync(binPath, "", "utf8");
  return { stateDir, binPath };
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
    const { stateDir, binPath } = makeRuntimeBin();
    expect(__testing.resolveLaunchCommand({ CRAWCLAW_STATE_DIR: stateDir })).toEqual({
      command: binPath,
      args: [],
    });
  });
});
