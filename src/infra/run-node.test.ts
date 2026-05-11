import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runNodeMain } from "../../scripts/run-node.mjs";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-run-node-"));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function createExitedProcess(code: number | null, signal: string | null = null) {
  return {
    on: (event: string, cb: (code: number | null, signal: string | null) => void) => {
      if (event === "exit") {
        queueMicrotask(() => cb(code, signal));
      }
      return undefined;
    },
  };
}

async function writeRustCliScaffold(tmp: string): Promise<void> {
  await fs.mkdir(path.join(tmp, "crates", "crawclaw-cli"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, "Cargo.toml"),
    '[workspace]\nmembers = ["crates/crawclaw-cli"]\n',
  );
  await fs.writeFile(
    path.join(tmp, "crates", "crawclaw-cli", "Cargo.toml"),
    '[package]\nname = "crawclaw-cli"\n',
  );
}

function createSpawnRecorder() {
  const spawnCalls: string[][] = [];
  const spawn = (cmd: string, args: string[]) => {
    spawnCalls.push([cmd, ...args]);
    return createExitedProcess(0);
  };
  const spawnSync = () => ({ status: 1, stdout: "" });
  return { spawnCalls, spawn, spawnSync };
}

function expectedRustCliSpawn(args: string[]) {
  return ["cargo", "run", "--quiet", "-p", "crawclaw-cli", "--", ...args];
}

describe("run-node script", () => {
  it("delegates every command to the Rust CLI in source checkouts", async () => {
    await withTempDir(async (tmp) => {
      await writeRustCliScaffold(tmp);
      const { spawnCalls, spawn, spawnSync } = createSpawnRecorder();

      const exitCode = await runNodeMain({
        cwd: tmp,
        args: ["agent", "--message", "hi"],
        env: {
          ...process.env,
          CRAWCLAW_RUNNER_LOG: "0",
        },
        spawn,
        spawnSync,
        execPath: process.execPath,
      });

      expect(exitCode).toBe(0);
      expect(spawnCalls).toEqual([expectedRustCliSpawn(["agent", "--message", "hi"])]);
    });
  });

  it("uses an explicit Rust CLI binary in packaged layouts", async () => {
    await withTempDir(async (tmp) => {
      const { spawnCalls, spawn, spawnSync } = createSpawnRecorder();
      const rustCli = path.join(tmp, "dist", "native", "crawclaw");

      const exitCode = await runNodeMain({
        cwd: tmp,
        args: ["status", "--json"],
        env: {
          ...process.env,
          CRAWCLAW_RUNNER_LOG: "0",
          CRAWCLAW_RUST_CLI_BIN: rustCli,
        },
        spawn,
        spawnSync,
        execPath: process.execPath,
      });

      expect(exitCode).toBe(0);
      expect(spawnCalls).toEqual([[rustCli, "status", "--json"]]);
    });
  });

  it.runIf(process.platform !== "win32")("uses the packaged Rust CLI before cargo", async () => {
    await withTempDir(async (tmp) => {
      await writeRustCliScaffold(tmp);
      const nativeCli = path.join(tmp, "dist", "native", "crawclaw");
      await fs.mkdir(path.dirname(nativeCli), { recursive: true });
      await fs.writeFile(nativeCli, "");
      const { spawnCalls, spawn, spawnSync } = createSpawnRecorder();

      const exitCode = await runNodeMain({
        cwd: tmp,
        args: ["health"],
        env: {
          ...process.env,
          CRAWCLAW_RUNNER_LOG: "0",
        },
        spawn,
        spawnSync,
        execPath: process.execPath,
      });

      expect(exitCode).toBe(0);
      expect(spawnCalls).toEqual([[nativeCli, "health"]]);
    });
  });

  it("fails closed instead of entering the TypeScript CLI when Rust is unavailable", async () => {
    await withTempDir(async (tmp) => {
      const { spawnCalls, spawn, spawnSync } = createSpawnRecorder();

      const exitCode = await runNodeMain({
        cwd: tmp,
        args: ["status"],
        env: {
          ...process.env,
          CRAWCLAW_RUNNER_LOG: "0",
        },
        spawn,
        spawnSync,
        execPath: process.execPath,
      });

      expect(exitCode).toBe(1);
      expect(spawnCalls).toEqual([]);
    });
  });
});
