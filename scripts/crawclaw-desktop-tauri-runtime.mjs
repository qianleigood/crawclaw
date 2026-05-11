#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");

export function resolveCrawClawDesktopTauriRuntimeStagePaths(checkRootDir = process.cwd()) {
  const runtimeRoot = path.join(checkRootDir, "apps", "crawclaw-desktop", ".runtime", "crawclaw");
  const binaryName = process.platform === "win32" ? "crawclaw.exe" : "crawclaw";
  return {
    runtimeRoot,
    runtimeBinaryPath: path.join(runtimeRoot, "bin", binaryName),
    sourceRuntimeBinaryPath: path.join(checkRootDir, "target", "release", binaryName),
  };
}

export function stageCrawClawDesktopTauriRuntime(params = {}) {
  const checkRootDir = params.rootDir ?? rootDir;
  const runCommand = params.runCommand ?? runCommandSync;
  const paths = resolveCrawClawDesktopTauriRuntimeStagePaths(checkRootDir);
  const buildEnv = createDesktopRuntimeDeployEnv(params.env ?? process.env, paths);

  fs.rmSync(paths.runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(paths.runtimeRoot), { recursive: true });

  if ((params.env ?? process.env).CRAWCLAW_DESKTOP_SKIP_ROOT_BUILD !== "1") {
    runChecked(runCommand, {
      cwd: checkRootDir,
      command: pnpmCommand(),
      args: ["build"],
      env: buildEnv,
    });
  }
  runChecked(runCommand, {
    cwd: checkRootDir,
    command: cargoCommand(),
    args: ["build", "-p", "crawclaw-cli", "--release"],
    env: buildEnv,
  });
  runChecked(runCommand, {
    cwd: checkRootDir,
    command: cargoCommand(),
    args: ["run", "-p", "crawclaw-cli", "--", "runtime", "stage", "--output", paths.runtimeRoot],
    env: buildEnv,
  });

  fs.mkdirSync(path.dirname(paths.runtimeBinaryPath), { recursive: true });
  fs.copyFileSync(paths.sourceRuntimeBinaryPath, paths.runtimeBinaryPath);

  if (process.platform !== "win32") {
    fs.chmodSync(paths.runtimeBinaryPath, 0o755);
  }
  assertRuntimeTree(paths);
  return paths;
}

export function assertCrawClawDesktopTauriReleaseInputs(params = {}) {
  const checkRootDir = params.rootDir ?? rootDir;
  const rootPackage = readJson(path.join(checkRootDir, "package.json"));
  const desktopPackage = readJson(
    path.join(checkRootDir, "apps", "crawclaw-desktop", "package.json"),
  );
  assertEqual(desktopPackage.version, rootPackage.version, "desktop package version");

  const tauriConfigPath = path.join(
    checkRootDir,
    "apps",
    "crawclaw-desktop",
    "src-tauri",
    "tauri.conf.json",
  );
  const tauriConfig = readJson(tauriConfigPath);
  assertEqual(tauriConfig.productName, "CrawClaw Desktop", "Tauri productName");
  assertEqual(tauriConfig.identifier, "ai.crawclaw.desktop", "Tauri identifier");
  assertEqual(
    tauriConfig.bundle?.resources?.["../.runtime/crawclaw"],
    "runtime/crawclaw",
    "Tauri embedded runtime resource",
  );
  assertFile(
    path.join(checkRootDir, "apps", "crawclaw-desktop", "dist", "index.html"),
    "Tauri React frontend dist/index.html",
  );

  const paths = resolveCrawClawDesktopTauriRuntimeStagePaths(checkRootDir);
  assertRuntimeTree(paths);
  assertRuntimeSmoke(paths, params.spawnSyncImpl ?? spawnSync);
  if (params.checkGeneratedPaths !== false) {
    assertNoDirtyGeneratedPaths(checkRootDir, params.spawnSyncImpl ?? spawnSync);
  }
}

function assertRuntimeTree(paths) {
  assertExecutableFile(paths.runtimeBinaryPath, "embedded Rust runtime binary");
  assertFile(
    path.join(paths.runtimeRoot, "runtimes", "manifest.json"),
    "embedded managed plugin runtime manifest",
  );
  assertFile(
    path.join(paths.runtimeRoot, "channels", "manifest.json"),
    "embedded Rust channel manifest",
  );
  assertRustChannelManifest(path.join(paths.runtimeRoot, "channels", "manifest.json"));
  assertNoDisallowedNodeRuntimeEntrypoints(paths.runtimeRoot);
}

function assertRustChannelManifest(manifestPath) {
  const manifest = readJson(manifestPath);
  assertEqual(manifest.implementation, "rust-native", "embedded Rust channel implementation");
  const ids = Array.isArray(manifest.channels)
    ? manifest.channels.map((channel) => channel?.id).filter(Boolean)
    : [];
  assertEqual(
    JSON.stringify(ids),
    JSON.stringify(["ddingtalk", "feishu", "esp32", "qqbot", "weixin"]),
    "embedded Rust channel ids",
  );
}

function assertRuntimeSmoke(paths, spawnSyncImpl) {
  assertNoLegacyDesktopSurface(paths.runtimeRoot);
  assertRuntimeSmokeCommand(paths, spawnSyncImpl, ["gateway", "--help"], "Gateway help");
  assertRuntimeSmokeCommand(
    paths,
    spawnSyncImpl,
    ["desktop-runtime", "status", "--json"],
    "desktop runtime status",
  );
  assertRuntimeSmokeCommand(
    paths,
    spawnSyncImpl,
    ["channels", "list", "--json"],
    "native channel list",
  );
}

function assertRuntimeSmokeCommand(paths, spawnSyncImpl, args, label) {
  const result = spawnSyncImpl(paths.runtimeBinaryPath, args, {
    cwd: paths.runtimeRoot,
    env: {
      ...process.env,
      CRAWCLAW_STATE_DIR: paths.runtimeRoot,
      CRAWCLAW_PLUGIN_RUNTIMES_DIR: path.join(paths.runtimeRoot, "runtimes"),
    },
    encoding: "utf-8",
    timeout: 30_000,
  });
  if (result.status === 0) {
    return;
  }
  const suffix = result.signal ? `signal ${result.signal}` : `exit ${String(result.status)}`;
  const detail = String(result.stderr || result.stdout || "").trim();
  throw new Error(
    `Tauri embedded CrawClaw runtime ${label} smoke failed with ${suffix}${detail ? `: ${detail}` : ""}`,
  );
}

function assertNoLegacyDesktopSurface(runtimeRoot) {
  const checkRootDir = path.resolve(runtimeRoot, "..", "..", "..", "..");
  const rootPackagePath = path.join(checkRootDir, "package.json");
  if (fs.existsSync(rootPackagePath)) {
    const rootPackage = readJson(rootPackagePath);
    const legacyScript = Object.keys(rootPackage.scripts ?? {}).find((name) =>
      name.startsWith("admin:desktop:"),
    );
    if (legacyScript) {
      throw new Error(
        `Legacy Electron Admin Desktop surface remains: package script ${legacyScript}`,
      );
    }
  }
  for (const legacyPath of [
    path.join(checkRootDir, "apps", "crawclaw-admin-desktop"),
    path.join(checkRootDir, "scripts", "admin-desktop-build.mjs"),
    path.join(checkRootDir, "scripts", "admin-desktop-release-check.mjs"),
    path.join(checkRootDir, "scripts", "admin-desktop-stage-runtime.mjs"),
    path.join(
      checkRootDir,
      "apps",
      "crawclaw-desktop",
      "src-tauri",
      "src",
      "gateway",
      "node_bridge.rs",
    ),
  ]) {
    if (fs.existsSync(legacyPath)) {
      throw new Error(`Legacy Electron Admin Desktop surface remains: ${legacyPath}`);
    }
  }
  for (const legacyPath of [
    path.join(checkRootDir, "apps", "crawclaw-desktop", "src-tauri", "src", "bff.rs"),
    path.join(checkRootDir, "apps", "crawclaw-desktop", "src-tauri", "src", "desktop_state.rs"),
  ]) {
    if (fs.existsSync(legacyPath)) {
      throw new Error(`Legacy Tauri Desktop BFF surface remains: ${legacyPath}`);
    }
  }
}

function assertNoDisallowedNodeRuntimeEntrypoints(runtimeRoot) {
  for (const filePath of walkFiles(runtimeRoot)) {
    if (!filePath.endsWith(".mjs")) {
      continue;
    }
    throw new Error(`Disallowed Node runtime entrypoint remains: ${filePath}`);
  }
}

function walkFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function createDesktopRuntimeDeployEnv(baseEnv, paths) {
  return {
    ...baseEnv,
    CRAWCLAW_STATE_DIR: paths.runtimeRoot,
    CRAWCLAW_PLUGIN_RUNTIMES_DIR: path.join(paths.runtimeRoot, "runtimes"),
    CRAWCLAW_RUNTIME_INSTALL_PROFILE: "desktop-core",
  };
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readText(filePath) {
  assertFile(filePath, filePath);
  return fs.readFileSync(filePath, "utf-8");
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function assertExecutableFile(filePath, label) {
  assertFile(filePath, label);
  if (process.platform === "win32") {
    return;
  }
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
  } catch {
    throw new Error(`${label} is not executable: ${filePath}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function runChecked(runCommand, invocation) {
  const result = runCommand(invocation);
  if (result.status === 0) {
    return;
  }
  const suffix = result.signal ? `signal ${result.signal}` : `exit ${String(result.status)}`;
  throw new Error(
    `${invocation.command} ${invocation.args.join(" ")} failed in ${invocation.cwd} with ${suffix}`,
  );
}

function assertNoDirtyGeneratedPaths(checkRootDir, spawnSyncImpl) {
  const generatedPaths = [
    "apps/crawclaw-desktop/.runtime",
    "apps/crawclaw-desktop/dist",
    "apps/crawclaw-desktop/src-tauri/target",
  ];
  const result = spawnSyncImpl("git", ["status", "--porcelain", "--", ...generatedPaths], {
    cwd: checkRootDir,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to inspect generated path status");
  }
  if (result.stdout.trim()) {
    throw new Error(`Generated Tauri desktop paths have tracked changes:\n${result.stdout}`);
  }
}

function runCommandSync({ cwd, command, args, env, stdio = "inherit" }) {
  return spawnSync(command, args, {
    cwd,
    stdio,
    env,
    encoding: stdio === "pipe" ? "utf-8" : undefined,
  });
}

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function cargoCommand() {
  return process.platform === "win32" ? "cargo.exe" : "cargo";
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const mode = process.argv[2] || "stage";
  if (mode === "check") {
    assertCrawClawDesktopTauriReleaseInputs();
  } else {
    const paths = stageCrawClawDesktopTauriRuntime();
    console.log(`Staged CrawClaw Tauri Desktop runtime at ${paths.runtimeRoot}`);
  }
}
