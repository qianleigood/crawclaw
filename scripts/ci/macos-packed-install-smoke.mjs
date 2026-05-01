#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverBundledPluginRuntimeDeps } from "../postinstall-bundled-plugins.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..", "..");
const DEFAULT_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = readTimeoutMsFromEnv(
  process.env,
  "CRAWCLAW_MACOS_PACKED_INSTALL_TIMEOUT_MS",
  30 * 60_000,
);
const GATEWAY_TIMEOUT_MS = readTimeoutMsFromEnv(
  process.env,
  "CRAWCLAW_MACOS_PACKED_GATEWAY_TIMEOUT_MS",
  3 * 60_000,
);
const GATEWAY_STOP_TIMEOUT_MS = readTimeoutMsFromEnv(
  process.env,
  "CRAWCLAW_MACOS_PACKED_GATEWAY_STOP_TIMEOUT_MS",
  10_000,
);
const SMOKE_GATEWAY_TOKEN = "macos-packed-install-smoke-token";
const REQUIRED_RUNTIME_PLUGINS = [
  "browser",
  "open-websearch",
  "scrapling-fetch",
  "notebooklm-mcp-cli",
];

function isDirectRun() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

function readTimeoutMsFromEnv(env, key, fallbackMs) {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallbackMs;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function tailOutput(text, maxChars = 8000) {
  if (!text) {
    return "";
  }
  return text.length > maxChars ? `[last ${maxChars} chars]\n${text.slice(-maxChars)}` : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${tailOutput(text)}`, { cause: error });
  }
}

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: "pipe",
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (result.status === 0 && !result.error) {
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
  const output = [
    result.stderr ? `stderr:\n${tailOutput(result.stderr)}` : "",
    result.stdout ? `stdout:\n${tailOutput(result.stdout)}` : "",
    result.error ? `error:\n${result.error.message}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  throw new Error(`Command failed: ${command} ${args.join(" ")}\n${output}`);
}

function resolvePackedTarball(packOutput, packDir) {
  const trimmed = packOutput.trim();
  const filename =
    trimmed
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

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireHealthyRuntimeEntry(pluginId, entry, requiredMetadataKeys = []) {
  const record = assertRecord(entry, `runtime manifest entry ${pluginId}`);
  if (record.state !== "healthy") {
    const detail = [
      typeof record.reason === "string" && record.reason.trim()
        ? `reason=${record.reason.trim()}`
        : "",
      typeof record.error === "string" && record.error.trim()
        ? `error=${tailOutput(record.error.trim(), 2000)}`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `runtime manifest entry ${pluginId} must be healthy, got ${String(record.state)}${
        detail ? ` (${detail})` : ""
      }`,
    );
  }
  for (const key of requiredMetadataKeys) {
    if (typeof record[key] !== "string" || record[key].trim() === "") {
      throw new Error(`runtime manifest entry ${pluginId} is missing ${key}`);
    }
  }
}

function validateRuntimeManifest(manifest) {
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
  requireHealthyRuntimeEntry("notebooklm-mcp-cli", plugins["notebooklm-mcp-cli"], [
    "binPath",
    "pythonVersion",
  ]);
}

function assertBundledPluginRuntimeDepsInstalled(packageRoot) {
  const extensionsDir = path.join(packageRoot, "dist", "extensions");
  const missing = discoverBundledPluginRuntimeDeps({ extensionsDir }).filter(
    (dep) => !fs.existsSync(path.join(packageRoot, dep.sentinelPath)),
  );
  if (missing.length === 0) {
    return;
  }
  throw new Error(
    `bundled plugin runtime deps are missing: ${missing
      .map((dep) => `${dep.name}@${dep.version}`)
      .join(", ")}`,
  );
}

function createTempLayout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-macos-pack-smoke-"));
  const packDir = path.join(root, "pack");
  const prefixDir = path.join(root, "prefix");
  const stateDir = path.join(root, "state");
  const homeDir = path.join(root, "home");
  const logsDir = path.join(root, "logs");
  for (const dir of [packDir, prefixDir, stateDir, homeDir, logsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return { root, packDir, prefixDir, stateDir, homeDir, logsDir };
}

function createSmokeEnv(temp) {
  const nextEnv = { ...process.env };
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
  nextEnv.CI ??= "true";
  nextEnv.NO_COLOR = "1";
  nextEnv.HOME = temp.homeDir;
  nextEnv.CRAWCLAW_HOME = temp.homeDir;
  nextEnv.CRAWCLAW_STATE_DIR = temp.stateDir;
  nextEnv.CRAWCLAW_CONFIG_PATH = path.join(temp.stateDir, "crawclaw.json");
  nextEnv.CRAWCLAW_GATEWAY_TOKEN = SMOKE_GATEWAY_TOKEN;
  nextEnv.CRAWCLAW_DISABLE_UPDATE_CHECK = "1";
  nextEnv.PATH = `${path.join(temp.prefixDir, "bin")}${path.delimiter}${nextEnv.PATH ?? ""}`;
  return nextEnv;
}

function writeGatewaySmokeConfig(smokeEnv, port) {
  const configPath = smokeEnv.CRAWCLAW_CONFIG_PATH;
  if (!configPath) {
    throw new Error("CRAWCLAW_CONFIG_PATH is required for macOS gateway smoke");
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        gateway: {
          mode: "local",
          port,
          bind: "loopback",
          auth: {
            mode: "token",
            token: SMOKE_GATEWAY_TOKEN,
          },
        },
        browser: {
          enabled: false,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function resolveFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }
        reject(new Error("failed to resolve a free local port"));
      });
    });
  });
}

async function waitForGatewayStatus(crawclawBin, smokeEnv, port) {
  const deadline = Date.now() + GATEWAY_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      return runOrThrow(
        crawclawBin,
        [
          "gateway",
          "status",
          "--url",
          `ws://127.0.0.1:${port}`,
          "--token",
          SMOKE_GATEWAY_TOKEN,
          "--require-rpc",
          "--json",
          "--timeout",
          "1000",
        ],
        { env: smokeEnv, timeoutMs: 10_000 },
      );
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw new Error(
    `gateway did not become RPC-ready within ${GATEWAY_TIMEOUT_MS}ms: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child, timeoutMs) {
  if (childHasExited(child)) {
    return true;
  }
  return await Promise.race([
    new Promise((resolve) => {
      child.once("exit", () => resolve(true));
    }),
    sleep(timeoutMs).then(() => false),
  ]);
}

function killChild(child, signal) {
  try {
    child.kill(signal);
  } catch {
    // Process already exited between status checks and signal delivery.
  }
}

async function stopChild(child) {
  if (childHasExited(child)) {
    return;
  }
  killChild(child, "SIGTERM");
  if (await waitForChildExit(child, GATEWAY_STOP_TIMEOUT_MS)) {
    return;
  }
  if (!childHasExited(child)) {
    killChild(child, "SIGKILL");
    await waitForChildExit(child, GATEWAY_STOP_TIMEOUT_MS);
  }
}

async function runForegroundGatewaySmoke(crawclawBin, smokeEnv, logsDir) {
  const port = await resolveFreePort();
  writeGatewaySmokeConfig(smokeEnv, port);
  const stdoutPath = path.join(logsDir, "gateway.stdout.log");
  const stderrPath = path.join(logsDir, "gateway.stderr.log");
  const stdout = fs.openSync(stdoutPath, "a");
  const stderr = fs.openSync(stderrPath, "a");
  const child = spawn(
    crawclawBin,
    [
      "gateway",
      "run",
      "--allow-unconfigured",
      "--token",
      SMOKE_GATEWAY_TOKEN,
      "--bind",
      "loopback",
      "--port",
      String(port),
      "--force",
    ],
    { env: smokeEnv, stdio: ["ignore", stdout, stderr] },
  );

  try {
    await waitForGatewayStatus(crawclawBin, smokeEnv, port);
  } catch (error) {
    const detail = [
      `stdout:\n${tailOutput(fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf8") : "")}`,
      `stderr:\n${tailOutput(fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf8") : "")}`,
    ].join("\n\n");
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${detail}`, {
      cause: error,
    });
  } finally {
    await stopChild(child);
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }
}

async function runSmoke({ keepTemp = false } = {}) {
  if (process.platform !== "darwin") {
    throw new Error(`macOS packed install smoke must run on darwin, got ${process.platform}`);
  }
  const temp = createTempLayout();
  const smokeEnv = createSmokeEnv(temp);
  const crawclawBin = path.join(temp.prefixDir, "bin", "crawclaw");
  const packageRoot = path.join(temp.prefixDir, "lib", "node_modules", "crawclaw");

  console.log(`[macos-smoke] temp root: ${temp.root}`);
  try {
    console.log("[macos-smoke] packing current checkout");
    const packResult = runOrThrow(
      "npm",
      ["pack", "--ignore-scripts", "--silent", "--pack-destination", temp.packDir],
      { cwd: REPO_ROOT, env: smokeEnv, timeoutMs: INSTALL_TIMEOUT_MS },
    );
    const tarballPath = resolvePackedTarball(packResult.stdout, temp.packDir);

    console.log("[macos-smoke] installing packed tarball into temporary global prefix");
    runOrThrow(
      "npm",
      ["install", "--global", "--prefix", temp.prefixDir, "--foreground-scripts", tarballPath],
      { cwd: REPO_ROOT, env: smokeEnv, timeoutMs: INSTALL_TIMEOUT_MS },
    );

    if (!fs.existsSync(crawclawBin)) {
      throw new Error(`installed crawclaw binary is missing: ${crawclawBin}`);
    }

    console.log("[macos-smoke] verifying installed CLI");
    runOrThrow(crawclawBin, ["--version"], { env: smokeEnv });

    console.log("[macos-smoke] checking bundled plugin runtime deps");
    assertBundledPluginRuntimeDepsInstalled(packageRoot);

    console.log("[macos-smoke] checking install-time runtime manifest");
    const manifestPath = path.join(temp.stateDir, "runtimes", "manifest.json");
    const manifest = parseJson(fs.readFileSync(manifestPath, "utf8"), "runtime manifest");
    validateRuntimeManifest(manifest);

    console.log("[macos-smoke] checking plugin catalog");
    parseJson(
      runOrThrow(crawclawBin, ["plugins", "list", "--json"], { env: smokeEnv }).stdout,
      "crawclaw plugins list --json",
    );

    console.log("[macos-smoke] checking foreground gateway startup");
    await runForegroundGatewaySmoke(crawclawBin, smokeEnv, temp.logsDir);

    console.log("[macos-smoke] packed install smoke passed");
  } finally {
    if (keepTemp) {
      console.log(`[macos-smoke] keeping temp root: ${temp.root}`);
    } else {
      fs.rmSync(temp.root, { recursive: true, force: true });
    }
  }
}

if (isDirectRun()) {
  runSmoke({ keepTemp: process.argv.includes("--keep-temp") }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
