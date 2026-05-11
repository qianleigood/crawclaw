#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NATIVE_BINARIES = [
  { packageName: "crawclaw-cli", binaryName: "crawclaw" },
  { packageName: "crawclaw-native-plugins", binaryName: "crawclaw-native-plugins" },
  { packageName: "crawclaw-runtime", binaryName: "crawclaw-runtime" },
  { packageName: "crawclaw-gateway", binaryName: "crawclaw-gateway" },
];

function platformBinaryName(name, platform = process.platform) {
  return platform === "win32" ? `${name}.exe` : name;
}

export function buildNativePlugins(params = {}) {
  const cwd = params.cwd ?? ROOT;
  const spawnSyncImpl = params.spawnSync ?? spawnSync;
  const fsImpl = params.fs ?? fs;
  const platform = params.platform ?? process.platform;
  const profile = params.profile ?? "release";
  const destDir = path.join(cwd, "dist", "native");
  fsImpl.mkdirSync(destDir, { recursive: true });

  const staged = [];
  for (const entry of NATIVE_BINARIES) {
    const cargoArgs = ["build", "-p", entry.packageName];
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

    const bin = platformBinaryName(entry.binaryName, platform);
    const source = path.join(cwd, "target", profile, bin);
    const dest = path.join(destDir, bin);
    fsImpl.copyFileSync(source, dest);
    fsImpl.chmodSync(dest, 0o755);
    staged.push(dest);
  }
  return staged;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const staged = buildNativePlugins();
    console.log(
      `[native-plugins] staged ${staged.map((dest) => path.relative(process.cwd(), dest)).join(", ")}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
