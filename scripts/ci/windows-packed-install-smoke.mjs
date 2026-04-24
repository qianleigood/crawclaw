#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverBundledPluginRuntimeDeps } from "../postinstall-bundled-plugins.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..", "..");
const MAX_OUTPUT_CHARS = 8000;
const UNSAFE_CMD_CHARS_RE = /[&|<>%\r\n]/;
const REQUIRED_RUNTIME_PLUGINS = ["browser", "open-websearch", "scrapling-fetch"];

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INSTALL_TIMEOUT_MS = 45 * 60_000;
const DEFAULT_GATEWAY_TIMEOUT_MS = 6 * 60_000;
const CLEANUP_RETRY_DELAYS_MS = [250, 750, 1_500, 3_000];
const GATEWAY_STATUS_RETRY_DELAY_MS = 2_000;
const GATEWAY_SMOKE_PORT_BASE = 49_152;
const GATEWAY_SMOKE_PORT_SPAN = 10_000;

export function readTimeoutMsFromEnv(env, key, fallbackMs) {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallbackMs;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallbackMs;
  }
  return parsed;
}

const INSTALL_TIMEOUT_MS = readTimeoutMsFromEnv(
  process.env,
  "CRAWCLAW_WINDOWS_PACKED_INSTALL_TIMEOUT_MS",
  DEFAULT_INSTALL_TIMEOUT_MS,
);
const GATEWAY_TIMEOUT_MS = readTimeoutMsFromEnv(
  process.env,
  "CRAWCLAW_WINDOWS_PACKED_GATEWAY_TIMEOUT_MS",
  DEFAULT_GATEWAY_TIMEOUT_MS,
);

function isDirectRun() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

function tailOutput(text, maxChars = MAX_OUTPUT_CHARS) {
  if (!text) {
    return "";
  }
  return text.length > maxChars
    ? `[last ${maxChars} chars]\n${text.slice(text.length - maxChars)}`
    : text;
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function escapeForCmdExe(arg) {
  if (UNSAFE_CMD_CHARS_RE.test(arg)) {
    throw new Error(`unsafe Windows cmd.exe argument detected: ${JSON.stringify(arg)}`);
  }
  const escaped = arg.replace(/\^/g, "^^");
  if (!escaped.includes(" ") && !escaped.includes('"')) {
    return escaped;
  }
  return `"${escaped.replace(/"/g, '""')}"`;
}

function buildCmdExeCommandLine(command, args) {
  return [escapeForCmdExe(command), ...args.map(escapeForCmdExe)].join(" ");
}

function normalizeWindowsCmdInvocation(command, args, env, platform = process.platform) {
  if (platform !== "win32") {
    return { command, args };
  }
  const ext = path.win32.extname(command).toLowerCase();
  if (ext !== ".cmd" && ext !== ".bat") {
    return { command, args };
  }
  return {
    command: env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", buildCmdExeCommandLine(command, args)],
    windowsVerbatimArguments: true,
  };
}

function resolveNpmCliPath() {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveNpmInvocation(args) {
  const npmCliPath = resolveNpmCliPath();
  if (npmCliPath) {
    return { command: process.execPath, args: [npmCliPath, ...args] };
  }
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args,
  };
}

function runOrThrow(command, args, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const invocation = normalizeWindowsCmdInvocation(command, args, env, platform);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env,
    stdio: "pipe",
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });

  if (result.status === 0 && !result.error) {
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      status: result.status,
    };
  }

  const output = [
    result.stderr ? `stderr:\n${tailOutput(result.stderr)}` : "",
    result.stdout ? `stdout:\n${tailOutput(result.stdout)}` : "",
    result.error ? `error:\n${result.error.message}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  throw new Error(
    [
      `Command failed: ${formatCommand(command, args)}`,
      `Exit code: ${String(result.status ?? "unknown")}`,
      output,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function runNpmOrThrow(args, options = {}) {
  const invocation = resolveNpmInvocation(args);
  return runOrThrow(invocation.command, invocation.args, options);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not print valid JSON: ${String(error)}\n${tailOutput(text)}`, {
      cause: error,
    });
  }
}

function parseArgs(argv) {
  const parsed = {
    includeGateway: false,
    keepTemp: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--include-gateway") {
      parsed.includeGateway = true;
      continue;
    }
    if (arg === "--keep-temp") {
      parsed.keepTemp = true;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }
  return parsed;
}

function resolvePathEnvKey(env, platform) {
  if (platform !== "win32") {
    return "PATH";
  }
  return (
    Object.keys(env).find((key) => key === "Path") ??
    Object.keys(env).find((key) => key.toLowerCase() === "path") ??
    "Path"
  );
}

export function resolveInstalledCrawClawBin({ prefixDir, platform = process.platform }) {
  if (platform === "win32") {
    return path.win32.join(prefixDir, "crawclaw.cmd");
  }
  return path.posix.join(prefixDir, "bin", "crawclaw");
}

export function resolveInstalledPackageRoot({ prefixDir, platform = process.platform }) {
  if (platform === "win32") {
    return path.win32.join(prefixDir, "node_modules", "crawclaw");
  }
  return path.posix.join(prefixDir, "lib", "node_modules", "crawclaw");
}

export function createSmokeEnv({
  env = process.env,
  prefixDir,
  stateDir,
  platform = process.platform,
}) {
  const nextEnv = { ...env };
  for (const key of Object.keys(nextEnv)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "npm_config_global" ||
      normalizedKey === "npm_config_location" ||
      normalizedKey === "npm_config_prefix"
    ) {
      delete nextEnv[key];
    }
  }

  const pathKey = resolvePathEnvKey(nextEnv, platform);
  const existingPath = nextEnv[pathKey] ?? "";
  nextEnv[pathKey] = existingPath ? `${prefixDir}${path.delimiter}${existingPath}` : prefixDir;
  nextEnv.CI = nextEnv.CI ?? "true";
  nextEnv.NO_COLOR = "1";
  nextEnv.CRAWCLAW_STATE_DIR = stateDir;
  nextEnv.CRAWCLAW_DISABLE_UPDATE_CHECK = "1";
  nextEnv.CRAWCLAW_RESTART_HEALTH_TIMEOUT_MS = String(GATEWAY_TIMEOUT_MS);
  nextEnv.CRAWCLAW_WINDOWS_TASK_NAME ??= resolveGatewaySmokeTaskName(stateDir, platform);
  return nextEnv;
}

export function resolveGatewaySmokeTaskName(stateDir, platform = process.platform) {
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  const tempRootName = pathImpl.basename(pathImpl.dirname(stateDir)) || "default";
  const suffix = tempRootName.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 48) || "default";
  return `crawclaw-gateway-smoke-${suffix}`;
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireHealthyRuntimeEntry(pluginId, entry, requiredMetadataKeys = []) {
  const record = assertRecord(entry, `runtime manifest entry ${pluginId}`);
  if (record.state !== "healthy") {
    throw new Error(
      `runtime manifest entry ${pluginId} must be healthy, got ${String(record.state)}`,
    );
  }
  for (const key of requiredMetadataKeys) {
    if (typeof record[key] !== "string" || record[key].trim() === "") {
      throw new Error(`runtime manifest entry ${pluginId} is missing ${key}`);
    }
  }
}

export function validateRuntimeManifest(manifest) {
  const record = assertRecord(manifest, "runtime manifest");
  const plugins = assertRecord(record.plugins, "runtime manifest plugins");
  for (const pluginId of REQUIRED_RUNTIME_PLUGINS) {
    if (!(pluginId in plugins)) {
      throw new Error(`runtime manifest is missing ${pluginId}`);
    }
  }

  requireHealthyRuntimeEntry("browser", plugins.browser, ["binPath"]);
  requireHealthyRuntimeEntry("open-websearch", plugins["open-websearch"], ["binPath"]);
  requireHealthyRuntimeEntry("scrapling-fetch", plugins["scrapling-fetch"], ["pythonVersion"]);
}

export function assertBundledPluginRuntimeDepsInstalled(params) {
  const packageRoot = params.packageRoot;
  if (typeof packageRoot !== "string" || packageRoot.trim() === "") {
    throw new Error("packageRoot is required");
  }
  const pathExists = params.existsSync ?? fs.existsSync;
  const extensionsDir = params.extensionsDir ?? path.join(packageRoot, "dist", "extensions");
  const runtimeDeps =
    params.runtimeDeps ??
    discoverBundledPluginRuntimeDeps({ extensionsDir, existsSync: pathExists });
  const missing = runtimeDeps.filter(
    (dep) => !pathExists(path.join(packageRoot, dep.sentinelPath)),
  );
  if (missing.length === 0) {
    return;
  }

  const missingDetails = missing
    .map((dep) => `${dep.name}@${dep.version} (used by ${dep.pluginIds.join(", ")})`)
    .join(", ");
  throw new Error(
    [
      `bundled plugin runtime deps are missing from the installed package root: ${missingDetails}`,
      `Expected them under: ${path.join(packageRoot, "node_modules")}`,
      "The package postinstall or doctor repair step must install these before bundled plugins are loaded.",
    ].join("\n"),
  );
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is missing or invalid at ${filePath}: ${String(error)}`, {
      cause: error,
    });
  }
}

function verifyRuntimeBinaries(manifest, smokeEnv) {
  const plugins = assertRecord(
    assertRecord(manifest, "runtime manifest").plugins,
    "runtime plugins",
  );
  for (const pluginId of ["browser", "open-websearch"]) {
    const entry = assertRecord(plugins[pluginId], `runtime manifest entry ${pluginId}`);
    const binPath = entry.binPath;
    if (typeof binPath !== "string" || binPath.trim() === "") {
      throw new Error(`runtime manifest entry ${pluginId} is missing binPath`);
    }
    runOrThrow(binPath, resolveRuntimeBinaryProbeArgs(pluginId), {
      env: smokeEnv,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  }
}

export function resolveRuntimeBinaryProbeArgs(pluginId) {
  if (pluginId === "open-websearch") {
    return ["--help"];
  }
  return ["--version"];
}

export function resolvePackedTarball(packOutput, packDir) {
  const trimmedOutput = packOutput.trim();
  if (trimmedOutput.startsWith("[")) {
    const parsed = parseJson(trimmedOutput, "npm pack");
    const first = Array.isArray(parsed) ? parsed[0] : null;
    if (first && typeof first.filename === "string" && first.filename.trim() !== "") {
      const filename = first.filename;
      return path.isAbsolute(filename) ? filename : path.join(packDir, filename);
    }
  }

  const filename =
    trimmedOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .toReversed()
      .find((line) => line.endsWith(".tgz")) ??
    fs.readdirSync(packDir).find((entry) => entry.endsWith(".tgz"));
  if (!filename) {
    throw new Error(`npm pack did not report a tarball filename: ${tailOutput(packOutput)}`);
  }
  return path.isAbsolute(filename) ? filename : path.join(packDir, filename);
}

function runCrawClaw(crawclawBin, args, options = {}) {
  return runOrThrow(crawclawBin, args, {
    ...options,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
}

function sleepSync(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

export function waitForGatewayRpcStatus(crawclawBin, smokeEnv, options = {}) {
  const timeoutMs = options.timeoutMs ?? GATEWAY_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? GATEWAY_STATUS_RETRY_DELAY_MS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? sleepSync;
  const run = options.run ?? runCrawClaw;
  const deadline = now() + timeoutMs;
  let lastError = null;

  while (now() <= deadline) {
    try {
      return run(crawclawBin, ["gateway", "status", "--deep", "--require-rpc", "--json"], {
        env: smokeEnv,
        timeoutMs: Math.max(1, Math.min(DEFAULT_TIMEOUT_MS, deadline - now())),
      });
    } catch (error) {
      lastError = error;
      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        break;
      }
      sleep(Math.min(retryDelayMs, remainingMs));
    }
  }

  throw new Error(
    `gateway did not become RPC-ready within ${timeoutMs}ms after Scheduled Task start: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    { cause: lastError },
  );
}

function parseNetstatListeningPorts(output) {
  const ports = new Set();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!/^tcp\b/i.test(line) || !/\blisten/i.test(line)) {
      continue;
    }
    const parts = line.split(/\s+/);
    const localAddress = parts[1] ?? "";
    const match = localAddress.match(/:(\d+)$/);
    if (!match) {
      continue;
    }
    const port = Number.parseInt(match[1], 10);
    if (Number.isFinite(port)) {
      ports.add(port);
    }
  }
  return ports;
}

function readListeningPortsSync() {
  const res = spawnSync("netstat", ["-ano", "-p", "tcp"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  if (res.error || res.status !== 0) {
    return new Set();
  }
  return parseNetstatListeningPorts(res.stdout);
}

export function resolveGatewaySmokePort(options = {}) {
  const listeningPorts = options.listeningPorts ?? readListeningPortsSync();
  const pid = options.pid ?? process.pid;
  const base = options.base ?? GATEWAY_SMOKE_PORT_BASE;
  const span = options.span ?? GATEWAY_SMOKE_PORT_SPAN;
  const startOffset = ((pid % span) * 37) % span;

  for (let offset = 0; offset < span; offset += 1) {
    const port = base + ((startOffset + offset) % span);
    if (!listeningPorts.has(port)) {
      return port;
    }
  }
  throw new Error(`could not find a free gateway smoke port in ${base}-${base + span - 1}`);
}

function isWindowsCleanupTransientError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  return ["EBUSY", "ENOTEMPTY", "EPERM", "EACCES"].includes(error.code);
}

export function cleanupTempRoot(root, options = {}) {
  const fsImpl = options.fsImpl ?? fs;
  const sleepImpl = options.sleepImpl ?? sleepSync;
  const warn = options.warn ?? console.warn;
  const retryDelaysMs = options.retryDelaysMs ?? CLEANUP_RETRY_DELAYS_MS;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      fsImpl.rmSync(root, { recursive: true, force: true });
      return true;
    } catch (error) {
      const canRetry = isWindowsCleanupTransientError(error) && attempt < retryDelaysMs.length;
      if (canRetry) {
        sleepImpl(retryDelaysMs[attempt]);
        continue;
      }
      if (isWindowsCleanupTransientError(error)) {
        warn(
          `[windows-smoke] warning: leaving temp root after cleanup failed with ${error.code}: ${root}`,
        );
        return false;
      }
      throw error;
    }
  }
  return false;
}

function createTempLayout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-windows-pack-smoke-"));
  const packDir = path.join(root, "pack");
  const prefixDir = path.join(root, "prefix");
  const stateDir = path.join(root, "state");
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(prefixDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  return { root, packDir, prefixDir, stateDir };
}

function runGatewayLifecycle(crawclawBin, smokeEnv) {
  const port = String(resolveGatewaySmokePort());
  console.log("[windows-smoke] configuring local gateway mode");
  runCrawClaw(crawclawBin, ["config", "set", "gateway.mode", "local"], {
    env: smokeEnv,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  console.log(`[windows-smoke] installing gateway service on port ${port}`);
  runCrawClaw(
    crawclawBin,
    ["gateway", "install", "--port", port, "--runtime", "node", "--force", "--json"],
    { env: smokeEnv, timeoutMs: GATEWAY_TIMEOUT_MS },
  );
  try {
    runCrawClaw(crawclawBin, ["gateway", "status", "--json"], {
      env: smokeEnv,
      timeoutMs: GATEWAY_TIMEOUT_MS,
    });
    runCrawClaw(crawclawBin, ["gateway", "restart", "--json"], {
      env: smokeEnv,
      timeoutMs: GATEWAY_TIMEOUT_MS,
    });
    waitForGatewayRpcStatus(crawclawBin, smokeEnv);
  } finally {
    runCrawClaw(crawclawBin, ["gateway", "stop", "--json"], {
      env: smokeEnv,
      timeoutMs: GATEWAY_TIMEOUT_MS,
    });
    runCrawClaw(crawclawBin, ["gateway", "uninstall", "--json"], {
      env: smokeEnv,
      timeoutMs: GATEWAY_TIMEOUT_MS,
    });
  }
}

function runSmoke(opts) {
  if (
    process.platform !== "win32" &&
    process.env.CRAWCLAW_WINDOWS_PACKED_INSTALL_SMOKE_ALLOW_NON_WINDOWS !== "1"
  ) {
    throw new Error(
      "windows-packed-install-smoke is intended for Windows runners. Set CRAWCLAW_WINDOWS_PACKED_INSTALL_SMOKE_ALLOW_NON_WINDOWS=1 to override.",
    );
  }

  const temp = createTempLayout();
  const smokeEnv = createSmokeEnv({
    env: process.env,
    prefixDir: temp.prefixDir,
    stateDir: temp.stateDir,
    platform: process.platform,
  });
  const crawclawBin = resolveInstalledCrawClawBin({
    prefixDir: temp.prefixDir,
    platform: process.platform,
  });
  const packageRoot = resolveInstalledPackageRoot({
    prefixDir: temp.prefixDir,
    platform: process.platform,
  });

  console.log(`[windows-smoke] temp root: ${temp.root}`);
  try {
    console.log("[windows-smoke] packing current checkout");
    const packResult = runNpmOrThrow(
      ["pack", "--ignore-scripts", "--silent", "--pack-destination", temp.packDir],
      { cwd: REPO_ROOT, env: smokeEnv, timeoutMs: DEFAULT_TIMEOUT_MS },
    );
    const tarballPath = resolvePackedTarball(packResult.stdout, temp.packDir);
    if (!fs.existsSync(tarballPath)) {
      throw new Error(`packed tarball was not created: ${tarballPath}`);
    }

    console.log("[windows-smoke] installing packed tarball into temporary global prefix");
    runNpmOrThrow(
      ["install", "--global", "--prefix", temp.prefixDir, "--foreground-scripts", tarballPath],
      { cwd: REPO_ROOT, env: smokeEnv, timeoutMs: INSTALL_TIMEOUT_MS },
    );

    if (!fs.existsSync(crawclawBin)) {
      throw new Error(`installed crawclaw shim is missing: ${crawclawBin}`);
    }

    console.log("[windows-smoke] verifying installed CLI");
    runCrawClaw(crawclawBin, ["--version"], { env: smokeEnv });

    console.log("[windows-smoke] checking bundled plugin runtime deps");
    assertBundledPluginRuntimeDepsInstalled({ packageRoot });

    console.log("[windows-smoke] checking install-time runtime manifest");
    const manifestPath = path.join(temp.stateDir, "runtimes", "manifest.json");
    const manifest = readJsonFile(manifestPath, "runtime manifest");
    validateRuntimeManifest(manifest);
    verifyRuntimeBinaries(manifest, smokeEnv);

    const runtimesList = runCrawClaw(crawclawBin, ["runtimes", "list", "--json"], {
      env: smokeEnv,
    });
    const runtimesPayload = parseJson(runtimesList.stdout, "crawclaw runtimes list --json");
    validateRuntimeManifest(assertRecord(runtimesPayload, "runtimes payload").manifest);

    console.log("[windows-smoke] checking plugin catalog and doctor");
    const pluginsList = runCrawClaw(crawclawBin, ["plugins", "list", "--json"], {
      env: smokeEnv,
    });
    parseJson(pluginsList.stdout, "crawclaw plugins list --json");
    runCrawClaw(crawclawBin, ["doctor", "--non-interactive"], { env: smokeEnv });

    if (opts.includeGateway) {
      runGatewayLifecycle(crawclawBin, smokeEnv);
    }

    console.log("[windows-smoke] packed install smoke passed");
  } finally {
    if (opts.keepTemp) {
      console.log(`[windows-smoke] keeping temp root: ${temp.root}`);
    } else {
      cleanupTempRoot(temp.root);
    }
  }
}

if (isDirectRun()) {
  try {
    runSmoke(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
