#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const DEFAULT_SOURCE_REPO = "https://github.com/searxng/searxng";
const DEFAULT_SOURCE_COMMIT = "afafca93f30939f213c1bc3fa3379e5ed883122d";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function copyFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function searxngPythonPath(venvDir, platform = process.platform) {
  return platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

export function resolveSearxngRuntimePaths(runtimeRoot, platform = process.platform) {
  const runtimeDir = path.join(runtimeRoot, "runtimes", "searxng");
  const venvDir = path.join(runtimeDir, "venv");
  return {
    runtimeDir,
    venvDir,
    pythonPath: searxngPythonPath(venvDir, platform),
    settingsPath: path.join(runtimeDir, "settings.yml"),
    manifestPath: path.join(runtimeDir, "manifest.json"),
    noticePath: path.join(runtimeDir, "NOTICE.md"),
    licensePath: path.join(runtimeDir, "LICENSE"),
    sourceLockPath: path.join(runtimeDir, "source.lock.json"),
    installStampPath: path.join(runtimeDir, ".searxng-install-stamp.json"),
  };
}

function bundledRuntimeAssetPath(rootDir, fileName) {
  return path.join(rootDir, "extensions", "searxng", "runtime", fileName);
}

function sourceLock(rootDir) {
  const candidate = bundledRuntimeAssetPath(rootDir, "source.lock.json");
  if (!fs.existsSync(candidate)) {
    return {
      sourceRepo: DEFAULT_SOURCE_REPO,
      sourceCommit: DEFAULT_SOURCE_COMMIT,
      license: "AGPL-3.0-or-later",
    };
  }
  return readJson(candidate);
}

export function writeSearxngRuntimeMetadata(params) {
  const rootDir = params.rootDir ?? repoRoot;
  const runtimeRoot = params.runtimeRoot;
  const paths = resolveSearxngRuntimePaths(runtimeRoot, params.platform ?? process.platform);
  const lock = sourceLock(rootDir);

  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  copyFile(bundledRuntimeAssetPath(rootDir, "settings.yml"), paths.settingsPath);
  copyFile(bundledRuntimeAssetPath(rootDir, "NOTICE.md"), paths.noticePath);
  copyFile(bundledRuntimeAssetPath(rootDir, "LICENSE"), paths.licensePath);
  writeJson(paths.sourceLockPath, lock);
  writeJson(paths.manifestPath, {
    id: "searxng",
    runtime: "python-sidecar",
    provider: "searxng",
    baseUrl: "http://127.0.0.1:3210",
    pythonPath: path.relative(paths.runtimeDir, paths.pythonPath).replaceAll("\\", "/"),
    settingsPath: path.relative(paths.runtimeDir, paths.settingsPath).replaceAll("\\", "/"),
    sourceRepo: lock.sourceRepo,
    sourceCommit: lock.sourceCommit,
    license: lock.license,
  });
  return { paths, lock };
}

function runChecked(runCommand, invocation) {
  const result = runCommand(invocation);
  if (result.status === 0) {
    return;
  }
  const suffix = result.signal ? `signal ${result.signal}` : `exit ${String(result.status)}`;
  const output = String(result.stderr || result.stdout || "").trim();
  throw new Error(
    `${invocation.command} ${invocation.args.join(" ")} failed with ${suffix}${output ? `: ${output}` : ""}`,
  );
}

function defaultPythonCommand(env) {
  return env.CRAWCLAW_SEARXNG_PYTHON || (process.platform === "win32" ? "python.exe" : "python3");
}

function shouldInstall(paths, lock) {
  if (!fs.existsSync(paths.pythonPath)) {
    return true;
  }
  try {
    const stamp = readJson(paths.installStampPath);
    return stamp.sourceCommit !== lock.sourceCommit;
  } catch {
    return true;
  }
}

export function stageSearxngRuntime(params = {}) {
  const rootDir = params.rootDir ?? repoRoot;
  const runtimeRoot = params.runtimeRoot;
  if (!runtimeRoot) {
    throw new Error("stageSearxngRuntime requires runtimeRoot");
  }
  const runCommand = params.runCommand ?? runCommandSync;
  const env = params.env ?? process.env;
  const { paths, lock } = writeSearxngRuntimeMetadata({
    rootDir,
    runtimeRoot,
    platform: params.platform,
  });
  if (!shouldInstall(paths, lock)) {
    return paths;
  }

  fs.rmSync(paths.venvDir, { recursive: true, force: true });
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  runChecked(runCommand, {
    cwd: paths.runtimeDir,
    command: defaultPythonCommand(env),
    args: ["-m", "venv", paths.venvDir],
    env,
  });
  const pipInstallSpec = `git+${lock.sourceRepo}@${lock.sourceCommit}`;
  for (const args of [
    ["-m", "pip", "install", "--upgrade", "pip"],
    ["-m", "pip", "install", pipInstallSpec],
  ]) {
    runChecked(runCommand, {
      cwd: paths.runtimeDir,
      command: paths.pythonPath,
      args,
      env,
    });
  }
  writeJson(paths.installStampPath, {
    sourceRepo: lock.sourceRepo,
    sourceCommit: lock.sourceCommit,
  });
  return paths;
}

function runCommandSync({ cwd, command, args, env, stdio = "inherit" }) {
  return spawnSync(command, args, {
    cwd,
    env,
    stdio,
    encoding: stdio === "pipe" ? "utf-8" : undefined,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const runtimeRoot =
    process.argv[2] || path.join(repoRoot, "apps", "crawclaw-desktop", ".runtime", "crawclaw");
  const paths = stageSearxngRuntime({ runtimeRoot });
  console.log(`Staged SearXNG runtime at ${paths.runtimeDir}`);
}
