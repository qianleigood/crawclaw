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
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..");
const SCRAPLING_REQUIREMENTS_LOCK = path.join(
  PACKAGE_ROOT,
  "extensions",
  "scrapling-fetch",
  "runtime",
  "requirements.lock.txt",
);

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

function resolvePythonCandidates(env = process.env) {
  const candidates = [
    env.CRAWCLAW_RUNTIME_PYTHON,
    env.CRAWCLAW_SCRAPLING_PYTHON,
    "/opt/homebrew/bin/python3",
    "python3.14",
    "python3.13",
    "python3.12",
    "python3.11",
    "python3.10",
    "python3",
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
  const minimum = { major: 3, minor: 10, patch: 0 };
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
      "No supported Python interpreter found for scrapling-fetch; requires Python >= 3.10.",
    );
  }
  return best;
}

function verifyScraplingRuntime(pythonBin) {
  runOrThrow(pythonBin, [
    "-c",
    "from scrapling.fetchers import Fetcher, StealthyFetcher, DynamicFetcher; import curl_cffi; import playwright; import browserforge; import msgspec; print('ok')",
  ]);
}

function installScraplingRuntime(env = process.env) {
  const runtimesRoot = resolveRuntimesRoot(env);
  const runtimeDir = path.join(runtimesRoot, "scrapling-fetch");
  const venvDir = path.join(runtimeDir, "venv");
  const python = resolveBestPython(env);
  const lockedPackages = readLockedRequirements(SCRAPLING_REQUIREMENTS_LOCK);
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
  runOrThrow(npmRunner.command, npmRunner.args, {
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
  runOrThrow(npmRunner.command, npmRunner.args, {
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

export function runPluginRuntimeInstall(params = {}) {
  const env = params.env ?? process.env;
  const log = params.log ?? console;
  if (env[DISABLE_RUNTIME_POSTINSTALL_ENV]?.trim()) {
    return;
  }
  const manifest = readManifest(env);
  const nextManifest = {
    ...manifest,
    plugins: {
      ...manifest.plugins,
      browser: installBrowserRuntime(env),
      "open-websearch": installOpenWebSearchRuntime(env),
      "scrapling-fetch": installScraplingRuntime(env),
    },
  };
  writeManifest(nextManifest, env);
  log.log("[postinstall] installed plugin runtimes: browser, open-websearch, scrapling-fetch");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runPluginRuntimeInstall();
}
