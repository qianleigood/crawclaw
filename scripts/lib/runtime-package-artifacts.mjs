import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const artifactCache = new Map();

function resolveRuntimeBinaryCandidates(params = {}) {
  if (params.runtimeBinary) {
    return [path.resolve(params.runtimeBinary)];
  }
  const binaryName = process.platform === "win32" ? "crawclaw-runtime.exe" : "crawclaw-runtime";
  return [
    path.join(REPO_ROOT, "target", "debug", binaryName),
    path.join(REPO_ROOT, "target", "release", binaryName),
    path.join(REPO_ROOT, "dist", "native", binaryName),
  ].filter((candidate) => existsSync(candidate));
}

function readRuntimePackageArtifacts(params = {}) {
  const rootDir = path.resolve(params.cwd ?? params.rootDir ?? process.cwd());
  const cargoCwd = params.cargoCwd ?? REPO_ROOT;
  const realHome = os.userInfo().homedir || os.homedir();
  const runtimeBinaries = resolveRuntimeBinaryCandidates(params);
  const cacheKey = JSON.stringify({ rootDir, cargoCwd, runtimeBinaries });
  const cached = artifactCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const env = {
    ...process.env,
    CARGO_HOME: process.env.CARGO_HOME ?? path.join(realHome, ".cargo"),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(realHome, ".rustup"),
    RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? "stable",
  };
  let raw;
  for (const runtimeBinary of runtimeBinaries) {
    try {
      raw = execFileSync(runtimeBinary, ["package-artifacts", "--root", rootDir, "--json"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      break;
    } catch (error) {
      const stderr = String(error?.stderr ?? "");
      if (!stderr.includes("unsupported crawclaw-runtime command: package-artifacts")) {
        throw error;
      }
    }
  }
  raw ??= execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "-p",
      "crawclaw-runtime",
      "--",
      "package-artifacts",
      "--root",
      rootDir,
      "--json",
    ],
    {
      cwd: cargoCwd,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const jsonLine = raw
    .trim()
    .split(/\r?\n/u)
    .findLast((line) => line.trim().startsWith("{"));
  if (!jsonLine) {
    throw new Error("crawclaw-runtime package-artifacts did not emit JSON");
  }
  const parsed = JSON.parse(jsonLine);
  artifactCache.set(cacheKey, parsed);
  return parsed;
}

export function listBundledPluginPackArtifacts(params = {}) {
  return readRuntimePackageArtifacts(params).bundledPluginPackArtifacts;
}

export function listStaticPackageAssetOutputs(params = {}) {
  return readRuntimePackageArtifacts(params).staticPackageAssetOutputs;
}
