#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveNpmRunner } from "./npm-runner.mjs";

const WINDOWS_UNSAFE_CMD_CHARS_RE = /[&|<>%\r\n]/;
const DISABLE_RUNTIME_POSTINSTALL_ENV = "CRAWCLAW_DISABLE_RUNTIME_POSTINSTALL";
const OPEN_WEBSEARCH_VERSION = "2.1.5";
const PINCHTAB_VERSION = "0.9.1";
const SCRAPLING_MINIMUM_PYTHON_VERSION = "3.10";
const SCRAPLING_PYTHON_ENV_OVERRIDES = ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_SCRAPLING_PYTHON"];
const NPM_INSTALL_MAX_ATTEMPTS = 3;
const NPM_INSTALL_RETRY_BASE_DELAY_MS = 1000;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..");
const SCRAPLING_REQUIREMENTS_LOCK = path.join(
  PACKAGE_ROOT,
  "extensions",
  "scrapling-fetch",
  "runtime",
  "requirements.lock.txt",
);
const WINDOWS_SCRAPLING_RUNTIME_PACKAGES = ["msvc-runtime==14.44.35112"];

function resolvePlatformPythonCandidates(platform = process.platform) {
  return platform === "win32"
    ? [
        "python3.14",
        "python3.13",
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
        "py",
      ]
    : [
        "/opt/homebrew/bin/python3",
        "python3.14",
        "python3.13",
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
      ];
}

function resolveStateRoot(env = process.env) {
  const override = env.CRAWCLAW_STATE_DIR?.trim();
  if (override) {
    return override;
  }
  return path.join(os.homedir(), ".crawclaw");
}

function resolveRuntimesRoot(env = process.env) {
  return path.join(resolveStateRoot(env), "runtimes");
}

function resolveManifestPath(env = process.env) {
  return path.join(resolveRuntimesRoot(env), "manifest.json");
}

function readLockedRequirements(filePath) {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function readManifest(env = process.env) {
  const filePath = resolveManifestPath(env);
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return { plugins: {} };
  }
}

function writeManifest(manifest, env = process.env) {
  const filePath = resolveManifestPath(env);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function escapeForCmdExe(arg) {
  if (WINDOWS_UNSAFE_CMD_CHARS_RE.test(arg)) {
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

function isWindowsCmdShim(command, platform) {
  if (platform !== "win32") {
    return false;
  }
  const ext = path.win32.extname(command).toLowerCase();
  return ext === ".cmd" || ext === ".bat";
}

export function resolveRuntimeSpawn(command, args, params = {}) {
  const env = params.env ?? process.env;
  const platform = params.platform ?? process.platform;
  if (!isWindowsCmdShim(command, platform)) {
    return { command, args };
  }
  return {
    command: params.comSpec ?? env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", buildCmdExeCommandLine(command, args)],
    shell: false,
    windowsVerbatimArguments: true,
  };
}

function runOrThrow(command, args, options = {}) {
  const runner = resolveRuntimeSpawn(command, args, { env: options.env });
  const result = spawnSync(runner.command, runner.args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
    shell: runner.shell ?? options.shell,
    windowsVerbatimArguments: runner.windowsVerbatimArguments ?? options.windowsVerbatimArguments,
  });
  if (result.status === 0) {
    return result;
  }
  const output = [result.stderr, result.stdout, result.error?.message]
    .filter(Boolean)
    .join("\n")
    .trim();
  throw new Error(output || `command failed: ${command} ${args.join(" ")}`);
}

function normalizeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function shouldRetryNpmInstallError(error) {
  const message = normalizeErrorMessage(error);
  return (
    /\b(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|EPIPE)\b/iu.test(message) ||
    /network aborted|network timeout|fetch failed|socket hang up/iu.test(message)
  );
}

export function runNpmInstallWithRetry(command, args, options = {}, deps = {}) {
  const runImpl = deps.runImpl ?? runOrThrow;
  const sleepImpl = deps.sleepImpl ?? sleepSync;
  const maxAttempts = deps.maxAttempts ?? NPM_INSTALL_MAX_ATTEMPTS;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return runImpl(command, args, options);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetryNpmInstallError(error)) {
        throw error;
      }
      sleepImpl(NPM_INSTALL_RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

function classifyRuntimeInstallError(error) {
  const message = normalizeErrorMessage(error);
  if (message.includes("No supported Python interpreter found")) {
    return "missing-python";
  }
  return "install-failed";
}

export function createUnavailableRuntimeEntry(error) {
  return {
    state: "unavailable",
    reason: classifyRuntimeInstallError(error),
    error: normalizeErrorMessage(error),
    installedAt: new Date().toISOString(),
  };
}

export function installRuntimeOrUnavailable(pluginId, installer, env = process.env, log = console) {
  log.log(`[postinstall] installing plugin runtime: ${pluginId}`);
  const startedAt = Date.now();
  try {
    const entry = installer(env);
    log.log(`[postinstall] plugin runtime ready: ${pluginId} (${Date.now() - startedAt}ms)`);
    return entry;
  } catch (error) {
    const entry = createUnavailableRuntimeEntry(error);
    log.warn(`[postinstall] plugin runtime unavailable: ${pluginId} (${entry.reason})`);
    return entry;
  }
}

export function createNestedNpmInstallEnv(env = process.env) {
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
  return nextEnv;
}

export function createLocalPrefixNpmInstallArgs(runtimeDir, packageSpec) {
  return [
    "install",
    "--global=false",
    "--prefix",
    runtimeDir,
    "--no-save",
    "--package-lock=false",
    packageSpec,
  ];
}

export function resolveScraplingVenvPython(venvDir, platform = process.platform) {
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  return platform === "win32"
    ? pathImpl.join(venvDir, "Scripts", "python.exe")
    : pathImpl.join(venvDir, "bin", "python");
}

export function resolveScraplingRuntimePackages(lockedPackages, platform = process.platform) {
  const packages =
    platform === "win32"
      ? [...lockedPackages, ...WINDOWS_SCRAPLING_RUNTIME_PACKAGES]
      : [...lockedPackages];
  return [...new Set(packages)];
}

export function resolvePythonCandidates(env = process.env, platform = process.platform) {
  const candidates = [
    ...SCRAPLING_PYTHON_ENV_OVERRIDES.map((key) => env[key]),
    ...resolvePlatformPythonCandidates(platform),
  ].filter(Boolean);
  return [...new Set(candidates)];
}

function parsePythonVersion(text) {
  const match = text.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    text: `${match[1]}.${match[2]}.${match[3]}`,
  };
}

function comparePythonVersion(a, b) {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

function resolveBestPython(env = process.env) {
  const [major, minor] = SCRAPLING_MINIMUM_PYTHON_VERSION.split(".").map(Number);
  const minimum = { major, minor, patch: 0 };
  let best = null;
  for (const candidate of resolvePythonCandidates(env)) {
    try {
      const result = runOrThrow(candidate, [
        "-c",
        "import sys; print('.'.join(map(str, sys.version_info[:3])))",
      ]);
      const version = parsePythonVersion(result.stdout);
      if (!version || comparePythonVersion(version, minimum) < 0) {
        continue;
      }
      if (!best || comparePythonVersion(version, best.version) > 0) {
        best = { command: candidate, version };
      }
    } catch {
      // Ignore missing interpreters and keep searching.
    }
  }
  if (!best) {
    throw new Error(
      `No supported Python interpreter found for scrapling-fetch; requires Python >= ${SCRAPLING_MINIMUM_PYTHON_VERSION}.`,
    );
  }
  return best;
}

export function buildScraplingImportCheckScript() {
  return [
    "import os",
    "import sys",
    "if os.name == 'nt':",
    "    _dll_handles = []",
    "    for _path in (sys.prefix, os.path.join(sys.prefix, 'Scripts')):",
    "        if os.path.isdir(_path):",
    "            _dll_handles.append(os.add_dll_directory(_path))",
    "from scrapling.fetchers import Fetcher, StealthyFetcher, DynamicFetcher",
    "import curl_cffi",
    "import playwright",
    "import browserforge",
    "import msgspec",
    "print('ok')",
  ].join("\n");
}

function verifyScraplingRuntime(pythonBin) {
  runOrThrow(pythonBin, ["-c", buildScraplingImportCheckScript()]);
}

function installScraplingRuntime(env = process.env) {
  const runtimesRoot = resolveRuntimesRoot(env);
  const runtimeDir = path.join(runtimesRoot, "scrapling-fetch");
  const venvDir = path.join(runtimeDir, "venv");
  const python = resolveBestPython(env);
  const lockedPackages = resolveScraplingRuntimePackages(
    readLockedRequirements(SCRAPLING_REQUIREMENTS_LOCK),
  );
  mkdirSync(runtimeDir, { recursive: true });
  const venvPython = resolveScraplingVenvPython(venvDir);
  if (!existsSync(venvPython)) {
    runOrThrow(python.command, ["-m", "venv", venvDir], { env });
  }
  runOrThrow(venvPython, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], {
    env,
  });
  runOrThrow(
    venvPython,
    ["-m", "pip", "install", "--disable-pip-version-check", ...lockedPackages],
    { env },
  );
  verifyScraplingRuntime(venvPython);
  return {
    state: "healthy",
    python: python.command,
    pythonVersion: python.version.text,
    venvDir,
    installedAt: new Date().toISOString(),
    packages: [...lockedPackages],
  };
}

function installOpenWebSearchRuntime(env = process.env) {
  const runtimeDir = path.join(resolveRuntimesRoot(env), "open-websearch");
  mkdirSync(runtimeDir, { recursive: true });
  const nestedEnv = createNestedNpmInstallEnv(env);
  const npmRunner = resolveNpmRunner({
    env: nestedEnv,
    npmArgs: createLocalPrefixNpmInstallArgs(
      runtimeDir,
      `open-websearch@${OPEN_WEBSEARCH_VERSION}`,
    ),
  });
  runNpmInstallWithRetry(npmRunner.command, npmRunner.args, {
    env: npmRunner.env ?? nestedEnv,
    shell: npmRunner.shell,
    windowsVerbatimArguments: npmRunner.windowsVerbatimArguments,
  });
  const binPath =
    process.platform === "win32"
      ? path.join(runtimeDir, "node_modules", ".bin", "open-websearch.cmd")
      : path.join(runtimeDir, "node_modules", ".bin", "open-websearch");
  if (!existsSync(binPath)) {
    throw new Error(`open-websearch binary missing after install: ${binPath}`);
  }
  return {
    state: "healthy",
    version: OPEN_WEBSEARCH_VERSION,
    installDir: runtimeDir,
    binPath,
    installedAt: new Date().toISOString(),
  };
}

function resolveBrowserRuntimeBin(runtimeDir) {
  return process.platform === "win32"
    ? path.join(runtimeDir, "node_modules", ".bin", "pinchtab.cmd")
    : path.join(runtimeDir, "node_modules", ".bin", "pinchtab");
}

function installBrowserRuntime(env = process.env) {
  const runtimeDir = path.join(resolveRuntimesRoot(env), "browser");
  mkdirSync(runtimeDir, { recursive: true });
  const nestedEnv = createNestedNpmInstallEnv(env);
  const npmRunner = resolveNpmRunner({
    env: nestedEnv,
    npmArgs: createLocalPrefixNpmInstallArgs(runtimeDir, `pinchtab@${PINCHTAB_VERSION}`),
  });
  runNpmInstallWithRetry(npmRunner.command, npmRunner.args, {
    env: npmRunner.env ?? nestedEnv,
    shell: npmRunner.shell,
    windowsVerbatimArguments: npmRunner.windowsVerbatimArguments,
  });
  const binPath = resolveBrowserRuntimeBin(runtimeDir);
  if (!existsSync(binPath)) {
    throw new Error(`pinchtab binary missing after install: ${binPath}`);
  }
  const version = runOrThrow(binPath, ["--version"], { env }).stdout.trim() || PINCHTAB_VERSION;
  return {
    state: "healthy",
    version,
    package: `pinchtab@${PINCHTAB_VERSION}`,
    installDir: runtimeDir,
    binPath,
    installedAt: new Date().toISOString(),
  };
}

function listManagedPluginRuntimeInstallers() {
  return [
    { id: "browser", installer: installBrowserRuntime },
    { id: "open-websearch", installer: installOpenWebSearchRuntime },
    { id: "scrapling-fetch", installer: installScraplingRuntime },
  ];
}

export function listManagedPluginRuntimeInstallPlan(params = {}) {
  const platform = params.platform ?? process.platform;
  return [
    {
      id: "browser",
      installTime: true,
      npmPackage: `pinchtab@${PINCHTAB_VERSION}`,
    },
    {
      id: "open-websearch",
      installTime: true,
      npmPackage: `open-websearch@${OPEN_WEBSEARCH_VERSION}`,
    },
    {
      id: "scrapling-fetch",
      installTime: true,
      python: {
        candidates: resolvePlatformPythonCandidates(platform),
        envOverrides: [...SCRAPLING_PYTHON_ENV_OVERRIDES],
        minimumVersion: SCRAPLING_MINIMUM_PYTHON_VERSION,
        requirementsLockPath: SCRAPLING_REQUIREMENTS_LOCK,
        windowsExtraPackages: [...WINDOWS_SCRAPLING_RUNTIME_PACKAGES],
      },
    },
  ];
}

export function runPluginRuntimeInstall(params = {}) {
  const env = params.env ?? process.env;
  const log = params.log ?? console;
  if (env[DISABLE_RUNTIME_POSTINSTALL_ENV]?.trim()) {
    return;
  }
  const manifest = readManifest(env);
  const nextPlugins = { ...manifest.plugins };
  for (const runtime of listManagedPluginRuntimeInstallers()) {
    nextPlugins[runtime.id] = installRuntimeOrUnavailable(runtime.id, runtime.installer, env, log);
  }
  const nextManifest = {
    ...manifest,
    plugins: nextPlugins,
  };
  writeManifest(nextManifest, env);
  const runtimeIds = listManagedPluginRuntimeInstallers().map((runtime) => runtime.id);
  log.log(`[postinstall] installed plugin runtimes: ${runtimeIds.join(", ")}`);
  const unavailable = Object.entries(nextPlugins)
    .filter(([, entry]) => entry?.state !== "healthy")
    .map(([pluginId, entry]) => `${pluginId} (${entry?.reason ?? "unavailable"})`);
  if (unavailable.length > 0) {
    log.warn(`[postinstall] plugin runtimes unavailable: ${unavailable.join(", ")}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runPluginRuntimeInstall();
}
