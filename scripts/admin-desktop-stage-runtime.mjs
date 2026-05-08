#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");

export function resolveAdminDesktopRuntimeStagePaths(checkRootDir = process.cwd()) {
  const runtimeRoot = path.join(
    checkRootDir,
    "apps",
    "crawclaw-admin-desktop",
    ".runtime",
    "crawclaw",
  );
  return {
    runtimeRoot,
    runtimeEntryPath: path.join(runtimeRoot, "crawclaw.mjs"),
    nodePath: path.join(runtimeRoot, "bin", process.platform === "win32" ? "node.exe" : "node"),
  };
}

export function stageAdminDesktopRuntime(params = {}) {
  const checkRootDir = params.rootDir ?? rootDir;
  const runCommand = params.runCommand ?? runCommandSync;
  const paths = resolveAdminDesktopRuntimeStagePaths(checkRootDir);
  const nodePath = resolveStableNodePath({
    env: params.env ?? process.env,
    runCommand,
    rootDir: checkRootDir,
  });
  const buildEnv = createStableNodeCommandEnv(params.env ?? process.env, nodePath);
  const deployEnv = createDesktopRuntimeDeployEnv(params.env ?? process.env, nodePath, paths);

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
    command: pnpmCommand(),
    args: ["--filter", "crawclaw", "deploy", paths.runtimeRoot, "--prod", "--legacy"],
    env: deployEnv,
  });
  fs.mkdirSync(path.dirname(paths.nodePath), { recursive: true });
  fs.copyFileSync(nodePath, paths.nodePath);

  assertFile(paths.runtimeEntryPath, "desktop bundled CrawClaw entrypoint");
  assertFile(paths.nodePath, "desktop bundled Node runtime");
  assertFile(
    path.join(paths.runtimeRoot, "dist", "index.js"),
    "desktop bundled CrawClaw dist/index.js",
  );
  assertFile(
    path.join(paths.runtimeRoot, "runtimes", "manifest.json"),
    "desktop bundled managed plugin runtime manifest",
  );
  assertFile(
    resolveScraplingRuntimePython(paths.runtimeRoot),
    "desktop bundled scrapling-fetch runtime",
  );
  assertFile(
    resolveNotebookLmRuntimeBin(paths.runtimeRoot),
    "desktop bundled notebooklm-mcp-cli runtime",
  );
  assertMissing(resolveN8nRuntimeDir(paths.runtimeRoot), "desktop optional n8n runtime");
  assertMissing(
    resolveRuntimeDir(paths.runtimeRoot, "skill-openai-whisper"),
    "desktop optional Whisper runtime",
  );
  assertMissing(
    resolveRuntimeDir(paths.runtimeRoot, "qwen3-tts"),
    "desktop optional Qwen3-TTS runtime",
  );
  if (process.platform !== "win32") {
    fs.chmodSync(paths.runtimeEntryPath, 0o755);
    fs.chmodSync(paths.nodePath, 0o755);
  }

  return paths;
}

export function resolveStableNodePath(params = {}) {
  const env = params.env ?? process.env;
  const explicit = env.CRAWCLAW_DESKTOP_RUNTIME_NODE_PATH?.trim();
  if (explicit) {
    assertNodeMajor(explicit, 24, params.runCommand ?? runCommandSync, params.rootDir ?? rootDir);
    return explicit;
  }

  if (Number.parseInt(process.versions.node.split(".")[0] ?? "", 10) === 24) {
    return process.execPath;
  }

  for (const candidate of stableNodeCandidates(env)) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    if (
      readNodeMajor(candidate, params.runCommand ?? runCommandSync, params.rootDir ?? rootDir) ===
      24
    ) {
      return candidate;
    }
  }

  throw new Error(
    "CrawClaw Desktop runtime staging requires Node 24. Set CRAWCLAW_DESKTOP_RUNTIME_NODE_PATH to a Node 24 binary.",
  );
}

function stableNodeCandidates(env) {
  const candidates = [
    "/usr/local/bin/node",
    "/opt/homebrew/opt/node@24/bin/node",
    "/opt/homebrew/bin/node",
    "/Applications/Codex.app/Contents/Resources/node",
  ];
  const pathEntries = String(env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => path.join(entry, process.platform === "win32" ? "node.exe" : "node"));
  return [...new Set([...candidates, ...pathEntries])];
}

function createStableNodeCommandEnv(baseEnv, nodePath) {
  return {
    ...baseEnv,
    CRAWCLAW_RUNTIME_NODE_VERSION: "24",
    PATH: `${path.dirname(nodePath)}${path.delimiter}${baseEnv.PATH || ""}`,
  };
}

function createDesktopRuntimeDeployEnv(baseEnv, nodePath, paths) {
  return {
    ...createStableNodeCommandEnv(baseEnv, nodePath),
    CRAWCLAW_STATE_DIR: paths.runtimeRoot,
    CRAWCLAW_PLUGIN_RUNTIMES_DIR: path.join(paths.runtimeRoot, "runtimes"),
    CRAWCLAW_RUNTIME_INSTALL_PROFILE: "desktop-core",
  };
}

function resolveRuntimeDir(runtimeRoot, id) {
  return path.join(runtimeRoot, "runtimes", "node-24", id);
}

function resolveN8nRuntimeDir(runtimeRoot) {
  return resolveRuntimeDir(runtimeRoot, "n8n");
}

function resolveScraplingRuntimePython(runtimeRoot) {
  return path.join(
    resolveRuntimeDir(runtimeRoot, "scrapling-fetch"),
    "venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python",
  );
}

function resolveNotebookLmRuntimeBin(runtimeRoot) {
  return path.join(
    resolveRuntimeDir(runtimeRoot, "notebooklm-mcp-cli"),
    "venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "notebooklm-mcp.exe" : "notebooklm-mcp",
  );
}

function assertNodeMajor(nodePath, expectedMajor, runCommand, cwd) {
  const major = readNodeMajor(nodePath, runCommand, cwd);
  if (major !== expectedMajor) {
    throw new Error(`Expected Node ${expectedMajor} at ${nodePath}, got Node ${String(major)}`);
  }
}

function readNodeMajor(nodePath, runCommand, cwd) {
  const result = runCommand({
    cwd,
    command: nodePath,
    args: ["-p", "process.versions.node.split('.')[0]"],
    env: process.env,
    stdio: "pipe",
  });
  if (result.status !== 0) {
    return null;
  }
  return Number.parseInt(String(result.stdout || "").trim(), 10);
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

function runCommandSync({ cwd, command, args, env, stdio = "inherit" }) {
  return spawnSync(command, args, {
    cwd,
    stdio,
    env,
    encoding: stdio === "pipe" ? "utf-8" : undefined,
  });
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function assertMissing(filePath, label) {
  if (fs.existsSync(filePath)) {
    throw new Error(`${label} should not be bundled: ${filePath}`);
  }
}

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const paths = stageAdminDesktopRuntime();
  console.log(`Staged CrawClaw Desktop runtime at ${paths.runtimeRoot}`);
}
