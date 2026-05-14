#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_BROWSER_VERSION,
  createLocalPrefixNpmInstallArgs,
} from "./install-plugin-runtimes.mjs";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const NODE_PLUGIN_RUNTIME_MAJOR = 24;
const REQUIRED_PROVIDER_TRANSPORT_IDS = [
  "amazon-bedrock",
  "anthropic",
  "anthropic-vertex",
  "azure-openai",
  "bedrock",
  "byteplus",
  "byteplus-plan",
  "chutes",
  "cloudflare-ai-gateway",
  "copilot-proxy",
  "deepseek",
  "github-copilot",
  "google",
  "google-gemini-cli",
  "huggingface",
  "kilocode",
  "kimi",
  "kimi-coding",
  "litellm",
  "microsoft-foundry",
  "minimax",
  "minimax-portal",
  "mistral",
  "modelstudio",
  "moonshot",
  "nvidia",
  "ollama",
  "openai",
  "openai-codex",
  "openai-compatible",
  "opencode",
  "opencode-go",
  "openrouter",
  "qianfan",
  "sglang",
  "synthetic",
  "together",
  "venice",
  "vercel-ai-gateway",
  "vllm",
  "volcengine",
  "volcengine-plan",
  "xai",
  "xiaomi",
  "zai",
];

export function resolveCrawClawDesktopTauriRuntimeStagePaths(checkRootDir = process.cwd()) {
  const runtimeRoot = path.join(checkRootDir, "apps", "crawclaw-desktop", ".runtime", "crawclaw");
  return {
    runtimeRoot,
    runtimeBinaryPath: path.join(runtimeRoot, "bin", runtimeBinaryName(process.platform)),
    gatewayBinaryPath: path.join(runtimeRoot, "bin", gatewayBinaryName(process.platform)),
    nativePluginsBinaryPath: path.join(
      runtimeRoot,
      "bin",
      nativePluginsBinaryName(process.platform),
    ),
    nodeRuntimeRoot: path.join(runtimeRoot, "runtimes", `node-v${NODE_PLUGIN_RUNTIME_MAJOR}`),
    nodeBinaryPath: path.join(
      runtimeRoot,
      "runtimes",
      `node-v${NODE_PLUGIN_RUNTIME_MAJOR}`,
      "bin",
      process.platform === "win32" ? "node.exe" : "node",
    ),
    npmBinaryPath: path.join(
      runtimeRoot,
      "runtimes",
      `node-v${NODE_PLUGIN_RUNTIME_MAJOR}`,
      "bin",
      process.platform === "win32" ? "npm.cmd" : "npm",
    ),
    sourceRuntimeBinaryPath: path.join(
      checkRootDir,
      "target",
      "release",
      runtimeBinaryName(process.platform),
    ),
    sourceGatewayBinaryPath: path.join(
      checkRootDir,
      "target",
      "release",
      gatewayBinaryName(process.platform),
    ),
    sourceNativePluginsBinaryPath: path.join(
      checkRootDir,
      "target",
      "release",
      nativePluginsBinaryName(process.platform),
    ),
  };
}

export function resolveCrawClawDesktopTauriPackagedRuntimePaths(
  checkRootDir = process.cwd(),
  platform = process.platform,
) {
  if (platform !== "darwin") {
    return null;
  }
  const runtimeRoot = path.join(
    checkRootDir,
    "target",
    "release",
    "bundle",
    "macos",
    "CrawClaw Desktop.app",
    "Contents",
    "Resources",
    "runtime",
    "crawclaw",
  );
  return {
    runtimeRoot,
    runtimeBinaryPath: path.join(runtimeRoot, "bin", runtimeBinaryName(platform)),
    gatewayBinaryPath: path.join(runtimeRoot, "bin", gatewayBinaryName(platform)),
    nativePluginsBinaryPath: path.join(runtimeRoot, "bin", nativePluginsBinaryName(platform)),
    nodeRuntimeRoot: path.join(runtimeRoot, "runtimes", `node-v${NODE_PLUGIN_RUNTIME_MAJOR}`),
    nodeBinaryPath: path.join(
      runtimeRoot,
      "runtimes",
      `node-v${NODE_PLUGIN_RUNTIME_MAJOR}`,
      "bin",
      platform === "win32" ? "node.exe" : "node",
    ),
    npmBinaryPath: path.join(
      runtimeRoot,
      "runtimes",
      `node-v${NODE_PLUGIN_RUNTIME_MAJOR}`,
      "bin",
      platform === "win32" ? "npm.cmd" : "npm",
    ),
  };
}

export function stageCrawClawDesktopTauriRuntime(params = {}) {
  const checkRootDir = params.rootDir ?? rootDir;
  const runCommand = params.runCommand ?? runCommandSync;
  const paths = resolveCrawClawDesktopTauriRuntimeStagePaths(checkRootDir);
  const buildEnv = createDesktopRuntimeDeployEnv(params.env ?? process.env, paths);

  fs.rmSync(paths.runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(paths.runtimeRoot), { recursive: true });

  runChecked(runCommand, {
    cwd: checkRootDir,
    command: cargoCommand(),
    args: [
      "build",
      "-p",
      "crawclaw-runtime",
      "-p",
      "crawclaw-gateway",
      "-p",
      "crawclaw-native-plugins",
      "--release",
    ],
    env: buildEnv,
  });
  runChecked(runCommand, {
    cwd: checkRootDir,
    command: paths.sourceRuntimeBinaryPath,
    args: ["stage", "--output", paths.runtimeRoot],
    env: buildEnv,
  });

  fs.mkdirSync(path.dirname(paths.runtimeBinaryPath), { recursive: true });
  for (const [source, dest] of [
    [paths.sourceRuntimeBinaryPath, paths.runtimeBinaryPath],
    [paths.sourceGatewayBinaryPath, paths.gatewayBinaryPath],
    [paths.sourceNativePluginsBinaryPath, paths.nativePluginsBinaryPath],
  ]) {
    fs.copyFileSync(source, dest);
    if (process.platform !== "win32") {
      fs.chmodSync(dest, 0o755);
    }
  }
  stageNodePluginRuntime(paths, buildEnv);
  stageEmbeddedBrowserRuntime(paths, buildEnv, runCommand);
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
  assertPackagedRuntimeTree(checkRootDir, params);
  if (params.checkGeneratedPaths !== false) {
    assertNoDirtyGeneratedPaths(checkRootDir, params.spawnSyncImpl ?? spawnSync);
  }
}

function assertRuntimeTree(paths, label = "embedded") {
  assertExecutableFile(paths.runtimeBinaryPath, `${label} Rust runtime binary`);
  assertExecutableFile(paths.gatewayBinaryPath, `${label} Rust gateway binary`);
  assertExecutableFile(paths.nativePluginsBinaryPath, `${label} native plugin binary`);
  assertNoPublicCliBinary(paths.runtimeRoot, label);
  assertFile(
    path.join(paths.runtimeRoot, "runtimes", "manifest.json"),
    `${label} managed plugin runtime manifest`,
  );
  assertNoDefaultJsPluginRuntime(
    path.join(paths.runtimeRoot, "runtimes", "manifest.json"),
    `${label} managed runtime manifest`,
  );
  assertFile(
    path.join(paths.runtimeRoot, "channels", "manifest.json"),
    `${label} Rust channel manifest`,
  );
  assertRustChannelManifest(path.join(paths.runtimeRoot, "channels", "manifest.json"));
  assertProviderTransportManifest(
    path.join(paths.runtimeRoot, "providers", "manifest.json"),
    label,
  );
  assertFile(
    path.join(paths.runtimeRoot, "plugins", "manifest.json"),
    `${label} Rust plugin manifest`,
  );
  assertNoDefaultJsPluginRuntime(
    path.join(paths.runtimeRoot, "plugins", "manifest.json"),
    `${label} Rust plugin manifest`,
  );
  assertNodePluginRuntime(paths, label);
  assertEmbeddedBrowserRuntime(paths, label);
  assertNoDisallowedNodeRuntimeSurface(paths.runtimeRoot);
}

function stageNodePluginRuntime(paths, env) {
  const sourceRoot = resolveNode24RuntimeRoot(env);
  fs.rmSync(paths.nodeRuntimeRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(paths.nodeRuntimeRoot), { recursive: true });
  fs.cpSync(sourceRoot, paths.nodeRuntimeRoot, {
    recursive: true,
    dereference: true,
    filter: (source) => !source.split(path.sep).includes(".git"),
  });
  assertNodeMajor(paths.nodeBinaryPath, NODE_PLUGIN_RUNTIME_MAJOR);
  assertExecutableFile(paths.nodeBinaryPath, "embedded Node 24 plugin runtime binary");
  assertExecutableFile(paths.npmBinaryPath, "embedded npm binary");
}

function resolveNode24RuntimeRoot(env) {
  const explicitRoot = env.CRAWCLAW_DESKTOP_NODE24_ROOT?.trim();
  if (explicitRoot) {
    const root = path.resolve(explicitRoot);
    assertNodeMajor(path.join(root, "bin", process.platform === "win32" ? "node.exe" : "node"));
    return root;
  }
  const explicitBin = env.CRAWCLAW_DESKTOP_NODE24_BIN?.trim();
  const nodeBin =
    explicitBin || findExecutableOnPath(process.platform === "win32" ? "node.exe" : "node");
  if (!nodeBin) {
    throw new Error("Node 24 runtime not found. Set CRAWCLAW_DESKTOP_NODE24_ROOT.");
  }
  assertNodeMajor(nodeBin, NODE_PLUGIN_RUNTIME_MAJOR);
  const root = path.resolve(path.dirname(nodeBin), "..");
  const npmBin = path.join(root, "bin", process.platform === "win32" ? "npm.cmd" : "npm");
  if (!fs.existsSync(npmBin)) {
    throw new Error(`Node 24 runtime root is missing npm: ${npmBin}`);
  }
  return root;
}

function findExecutableOnPath(name) {
  for (const entry of (process.env.PATH || "").split(path.delimiter)) {
    if (!entry) {
      continue;
    }
    const candidate = path.join(entry, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function assertNodeMajor(nodeBin, major = NODE_PLUGIN_RUNTIME_MAJOR) {
  assertExecutableFile(nodeBin, `Node ${major} plugin runtime binary`);
  const result = spawnSync(nodeBin, ["--version"], { encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`Failed to run ${nodeBin} --version: ${result.stderr || result.stdout}`);
  }
  const actual = (result.stdout || "").trim();
  if (!actual.startsWith(`v${major}.`)) {
    throw new Error(`Node plugin runtime must be Node ${major}.x, got ${actual}`);
  }
}

function assertNodePluginRuntime(paths, label) {
  assertNodePluginRuntimeManifest(
    path.join(paths.runtimeRoot, "runtimes", "manifest.json"),
    `${label} managed runtime manifest`,
  );
  assertNodePluginRuntimeManifest(
    path.join(paths.runtimeRoot, "plugins", "manifest.json"),
    `${label} plugin manifest`,
  );
  assertNodeMajor(paths.nodeBinaryPath, NODE_PLUGIN_RUNTIME_MAJOR);
  assertExecutableFile(paths.npmBinaryPath, `${label} npm binary`);
}

function browserRuntimeDir(paths) {
  return path.join(paths.runtimeRoot, "runtimes", "browser");
}

function browserRuntimeBinPath(paths) {
  return process.platform === "win32"
    ? path.join(browserRuntimeDir(paths), "node_modules", ".bin", "agent-browser.cmd")
    : path.join(browserRuntimeDir(paths), "node_modules", ".bin", "agent-browser");
}

function stageEmbeddedBrowserRuntime(paths, env, runCommand) {
  const runtimeDir = browserRuntimeDir(paths);
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  const nodeBinDir = path.dirname(paths.nodeBinaryPath);
  const npmCli = npmCliScriptPath(paths);
  runChecked(runCommand, {
    cwd: paths.runtimeRoot,
    command: paths.nodeBinaryPath,
    args: [
      npmCli,
      ...createLocalPrefixNpmInstallArgs(runtimeDir, `agent-browser@${AGENT_BROWSER_VERSION}`),
    ],
    env: {
      ...env,
      CRAWCLAW_DESKTOP_NODE24_BIN: paths.nodeBinaryPath,
      PATH: [nodeBinDir, env.PATH].filter(Boolean).join(path.delimiter),
    },
  });
  assertEmbeddedBrowserRuntime(paths, "embedded");
}

function npmCliScriptPath(paths) {
  const candidates = [
    path.join(paths.nodeRuntimeRoot, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(paths.nodeRuntimeRoot, "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const candidate = candidates.find((entry) => fs.existsSync(entry));
  if (!candidate) {
    throw new Error(`Node 24 runtime root is missing npm cli script: ${candidates.join(" or ")}`);
  }
  return candidate;
}

function assertEmbeddedBrowserRuntime(paths, label) {
  assertExecutableFile(browserRuntimeBinPath(paths), `${label} agent-browser CLI`);
  const packageJsonPath = path.join(
    browserRuntimeDir(paths),
    "node_modules",
    "agent-browser",
    "package.json",
  );
  const packageJson = readJson(packageJsonPath);
  assertEqual(packageJson.name, "agent-browser", `${label} agent-browser package name`);
  assertEqual(packageJson.version, AGENT_BROWSER_VERSION, `${label} agent-browser package version`);
}

function assertNodePluginRuntimeManifest(manifestPath, label) {
  const manifest = readJson(manifestPath);
  assertEqual(manifest.jsPluginRuntime, "node", `${label} JS plugin runtime`);
  assertEqual(manifest.node?.major, NODE_PLUGIN_RUNTIME_MAJOR, `${label} Node runtime major`);
}

function assertPackagedRuntimeTree(checkRootDir, params) {
  if (params.checkPackagedBundle === false) {
    return;
  }
  const paths = resolveCrawClawDesktopTauriPackagedRuntimePaths(
    checkRootDir,
    params.platform ?? process.platform,
  );
  if (!paths) {
    return;
  }
  assertRuntimeTree(paths, "packaged Tauri macOS app embedded runtime");
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

function assertProviderTransportManifest(manifestPath, label) {
  assertFile(manifestPath, `${label} Rust provider transport manifest`);
  const manifest = readJson(manifestPath);
  const transports = Array.isArray(manifest.transports) ? manifest.transports : [];
  if (transports.length === 0) {
    throw new Error(`${label} Rust provider transport manifest is missing transports`);
  }
  const transportIds = new Set(transports.map((transport) => transport?.id).filter(Boolean));
  for (const id of REQUIRED_PROVIDER_TRANSPORT_IDS) {
    if (!transportIds.has(id)) {
      throw new Error(`${label} Rust provider transport manifest is missing ${id}`);
    }
  }
  for (const transport of transports) {
    const capabilities = transport?.capabilities ?? {};
    if (
      capabilities.streaming !== true ||
      capabilities.toolCalling !== true ||
      capabilities.multimodal !== true ||
      capabilities.secretRef?.env !== true ||
      capabilities.secretRef?.file !== true ||
      capabilities.secretRef?.exec !== false
    ) {
      throw new Error(
        `${label} Rust provider transport manifest has incomplete capabilities for ${String(
          transport?.id ?? "unknown",
        )}`,
      );
    }
  }
}

function assertRuntimeSmoke(paths, spawnSyncImpl) {
  assertNoLegacyDesktopSurface(paths.runtimeRoot);
  assertRuntimeSmokeCommand(
    paths.runtimeBinaryPath,
    paths,
    spawnSyncImpl,
    ["status", "--json"],
    "runtime status",
  );
  assertRuntimeSmokeCommand(
    paths.gatewayBinaryPath,
    paths,
    spawnSyncImpl,
    ["--help"],
    "Gateway help",
  );
  assertRuntimeSmokeCommand(
    paths.nativePluginsBinaryPath,
    paths,
    spawnSyncImpl,
    ["--help"],
    "native plugin help",
  );
  assertRuntimeSmokeCommand(
    browserRuntimeBinPath(paths),
    paths,
    spawnSyncImpl,
    ["--version"],
    "agent-browser CLI",
  );
}

function assertRuntimeSmokeCommand(command, paths, spawnSyncImpl, args, label) {
  const result = spawnSyncImpl(command, args, {
    cwd: paths.runtimeRoot,
    env: {
      ...process.env,
      CRAWCLAW_STATE_DIR: paths.runtimeRoot,
      CRAWCLAW_DESKTOP_NODE24_BIN: paths.nodeBinaryPath,
      CRAWCLAW_PLUGIN_RUNTIMES_DIR: path.join(paths.runtimeRoot, "runtimes"),
      PATH: [path.dirname(paths.nodeBinaryPath), process.env.PATH]
        .filter(Boolean)
        .join(path.delimiter),
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

function assertNoDisallowedNodeRuntimeSurface(runtimeRoot) {
  for (const filePath of walkFiles(runtimeRoot)) {
    if (filePath.split(path.sep).includes(`node-v${NODE_PLUGIN_RUNTIME_MAJOR}`)) {
      continue;
    }
    if (isEmbeddedBrowserRuntimeFile(runtimeRoot, filePath)) {
      continue;
    }
    if (!filePath.endsWith(".mjs")) {
      const basename = path.basename(filePath);
      if (basename !== "package.json" && !filePath.split(path.sep).includes("node_modules")) {
        continue;
      }
      throw new Error(`Disallowed Node runtime package surface remains: ${filePath}`);
    }
    throw new Error(`Disallowed Node runtime entrypoint remains: ${filePath}`);
  }
}

function isEmbeddedBrowserRuntimeFile(runtimeRoot, filePath) {
  const browserRuntimeRoot = path.join(runtimeRoot, "runtimes", "browser");
  const relative = path.relative(browserRuntimeRoot, filePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertNoPublicCliBinary(runtimeRoot, label) {
  const cliPath = path.join(
    runtimeRoot,
    "bin",
    process.platform === "win32" ? "crawclaw.exe" : "crawclaw",
  );
  if (fs.existsSync(cliPath)) {
    throw new Error(`${label} must not embed the public crawclaw CLI binary: ${cliPath}`);
  }
}

function assertNoDefaultJsPluginRuntime(manifestPath, label) {
  const manifest = readJson(manifestPath);
  if (manifest.jsPluginRuntime && manifest.jsPluginRuntime !== "node") {
    throw new Error(`${label} must advertise the bundled Node plugin runtime: ${manifestPath}`);
  }
  if (JSON.stringify(manifest).includes("pi-quickjs")) {
    throw new Error(`${label} must not stage Pi QuickJS fallback metadata: ${manifestPath}`);
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

function cargoCommand() {
  return process.platform === "win32" ? "cargo.exe" : "cargo";
}

function runtimeBinaryName(platform) {
  return platform === "win32" ? "crawclaw-runtime.exe" : "crawclaw-runtime";
}

function gatewayBinaryName(platform) {
  return platform === "win32" ? "crawclaw-gateway.exe" : "crawclaw-gateway";
}

function nativePluginsBinaryName(platform) {
  return platform === "win32" ? "crawclaw-native-plugins.exe" : "crawclaw-native-plugins";
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
