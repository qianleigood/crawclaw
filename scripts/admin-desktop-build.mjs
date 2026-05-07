#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const rootDir = process.cwd();
const adminDir = join(rootDir, "apps", "crawclaw-admin");
const desktopDir = join(rootDir, "apps", "crawclaw-admin-desktop");

ensureNpmInstall(adminDir);
runNpm(adminDir, ["run", "build"]);
ensureNpmInstall(desktopDir);
runNpm(desktopDir, ["run", "rebuild:native"]);
runNpm(desktopDir, ["run", "dist"]);

function ensureNpmInstall(cwd) {
  if (existsSync(join(cwd, "node_modules"))) {
    return;
  }
  runNpm(cwd, ["install"]);
}

function runNpm(cwd, args) {
  const result = spawnSync(npmCommand(), args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status === 0) {
    return;
  }
  const suffix = result.signal ? `signal ${result.signal}` : `exit ${String(result.status)}`;
  throw new Error(`npm ${args.join(" ")} failed in ${cwd} with ${suffix}`);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
