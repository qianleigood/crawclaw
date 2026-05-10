#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function binaryName(platform = process.platform) {
  return platform === "win32" ? "crawclaw-native-plugins.exe" : "crawclaw-native-plugins";
}

export function buildNativePlugins(params = {}) {
  const cwd = params.cwd ?? ROOT;
  const spawnSyncImpl = params.spawnSync ?? spawnSync;
  const fsImpl = params.fs ?? fs;
  const platform = params.platform ?? process.platform;
  const profile = params.profile ?? "release";
  const cargoArgs = ["build", "-p", "crawclaw-native-plugins"];
  if (profile === "release") {
    cargoArgs.push("--release");
  }

  const build = spawnSyncImpl("cargo", cargoArgs, {
    cwd,
    stdio: params.stdio ?? "inherit",
  });
  if (build.status !== 0) {
    throw new Error(`cargo ${cargoArgs.join(" ")} failed with status ${build.status ?? "?"}`);
  }

  const bin = binaryName(platform);
  const source = path.join(cwd, "target", profile, bin);
  const destDir = path.join(cwd, "dist", "native");
  const dest = path.join(destDir, bin);
  fsImpl.mkdirSync(destDir, { recursive: true });
  fsImpl.copyFileSync(source, dest);
  fsImpl.chmodSync(dest, 0o755);
  return dest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const dest = buildNativePlugins();
    console.log(`[native-plugins] staged ${path.relative(process.cwd(), dest)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
