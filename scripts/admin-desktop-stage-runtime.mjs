#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = resolve(dirname(__filename), "..");
const runtimeStageDir = join(rootDir, "apps", "crawclaw-admin-desktop", ".runtime", "crawclaw");

if (process.env.CRAWCLAW_DESKTOP_SKIP_ROOT_BUILD !== "1") {
  runPnpm(["build"]);
}

rmSync(runtimeStageDir, { recursive: true, force: true });
mkdirSync(dirname(runtimeStageDir), { recursive: true });
runPnpm(["--filter", "crawclaw", "deploy", runtimeStageDir, "--prod", "--legacy"]);

assertFile(join(runtimeStageDir, "crawclaw.mjs"), "desktop bundled CrawClaw entrypoint");
assertFile(join(runtimeStageDir, "dist", "index.js"), "desktop bundled CrawClaw dist/index.js");

console.log(`Staged CrawClaw Desktop runtime at ${runtimeStageDir}`);

function runPnpm(args) {
  const result = spawnSync(pnpmCommand(), args, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status === 0) {
    return;
  }
  const suffix = result.signal ? `signal ${result.signal}` : `exit ${String(result.status)}`;
  throw new Error(`pnpm ${args.join(" ")} failed with ${suffix}`);
}

function assertFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}
