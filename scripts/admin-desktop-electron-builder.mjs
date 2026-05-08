#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const builderPath = path.join(
  cwd,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
);

if (!existsSync(builderPath)) {
  throw new Error(`Missing electron-builder binary: ${builderPath}`);
}

const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || "false",
};
const args = withSkipSigningConfig(process.argv.slice(2), env);
const result = spawnSync(builderPath, args, {
  cwd,
  env,
  stdio: "inherit",
});

if (result.status === 0) {
  process.exit(0);
}
if (result.signal) {
  throw new Error(`electron-builder failed with signal ${result.signal}`);
}
throw new Error(`electron-builder failed with exit ${String(result.status)}`);

function withSkipSigningConfig(args, env) {
  if (env.CSC_IDENTITY_AUTO_DISCOVERY !== "false") {
    return args;
  }
  if (args.some((arg) => arg.startsWith("--config.mac.identity"))) {
    return args;
  }
  return [...args, "--config.mac.identity=null"];
}
