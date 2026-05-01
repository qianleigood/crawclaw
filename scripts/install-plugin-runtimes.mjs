#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveNpmRunner } from "./npm-runner.mjs";

const WINDOWS_UNSAFE_CMD_CHARS_RE = /[&|<>%\r\n]/;
const DISABLE_RUNTIME_POSTINSTALL_ENV = "CRAWCLAW_DISABLE_RUNTIME_POSTINSTALL";
const OPEN_WEBSEARCH_VERSION = "2.1.5";
const PINCHTAB_VERSION = "0.9.1";
const N8N_VERSION = "2.18.5";
const N8N_ZH_CN_EDITOR_UI_SOURCE = "other-blowsnow/n8n-i18n-chinese";
const CORE_SKILLS_MINIMUM_PYTHON_VERSION = "3.10";
const SCRAPLING_MINIMUM_PYTHON_VERSION = "3.10";
const NOTEBOOKLM_MCP_CLI_VERSION = "0.6.1";
const NOTEBOOKLM_MINIMUM_PYTHON_VERSION = "3.11";
const CORE_SKILLS_PYTHON_ENV_OVERRIDES = ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_CORE_SKILLS_PYTHON"];
const SCRAPLING_PYTHON_ENV_OVERRIDES = ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_SCRAPLING_PYTHON"];
const NOTEBOOKLM_PYTHON_ENV_OVERRIDES = ["CRAWCLAW_RUNTIME_PYTHON", "CRAWCLAW_NOTEBOOKLM_PYTHON"];
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
const CORE_SKILLS_REQUIREMENTS_LOCK = path.join(
  PACKAGE_ROOT,
  "skills",
  ".runtime",
  "requirements.lock.txt",
);
const OPENAI_WHISPER_REQUIREMENTS_LOCK = path.join(
  PACKAGE_ROOT,
  "skills",
  "openai-whisper",
  "runtime",
  "requirements.macos-arm64.lock.txt",
);
const WINDOWS_SCRAPLING_RUNTIME_PACKAGES = ["msvc-runtime==14.44.35112"];

function resolvePlatformPythonCandidates(platform = process.platform) {
  const baseCandidates = [
    "python3.14",
    "python3.13",
    "python3.12",
    "python3.11",
    "python3.10",
    "python3",
    "python",
  ];
  if (platform === "win32") {
    return [...baseCandidates, "py"];
  }
  if (platform === "darwin") {
    return ["/opt/homebrew/bin/python3", ...baseCandidates];
  }
  return baseCandidates;
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

export function resolveN8nChineseEditorUiUrl(version = N8N_VERSION) {
  return `https://github.com/${N8N_ZH_CN_EDITOR_UI_SOURCE}/releases/download/release%2F${version}/editor-ui.tar.gz`;
}

function resolveN8nEditorUiDistDir(runtimeDir) {
  return path.join(runtimeDir, "node_modules", "n8n-editor-ui", "dist");
}

function resolveN8nEditorUiLocalizationMetadataPath(distDir) {
  return path.join(distDir, ".crawclaw-localization.json");
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

export function resolveNotebookLmVenvBin(venvDir, binName = "nlm", platform = process.platform) {
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  const suffix = platform === "win32" ? ".exe" : "";
  return platform === "win32"
    ? pathImpl.join(venvDir, "Scripts", `${binName}${suffix}`)
    : pathImpl.join(venvDir, "bin", binName);
}

export function resolveScraplingRuntimePackages(lockedPackages, platform = process.platform) {
  const packages =
    platform === "win32"
      ? [...lockedPackages, ...WINDOWS_SCRAPLING_RUNTIME_PACKAGES]
      : [...lockedPackages];
  return [...new Set(packages)];
}

export function resolvePythonCandidates(
  env = process.env,
  platform = process.platform,
  envOverrides = SCRAPLING_PYTHON_ENV_OVERRIDES,
) {
  const candidates = [
    ...envOverrides.map((key) => env[key]),
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

function resolveBestPython(env = process.env, params = {}) {
  const minimumVersion = params.minimumVersion ?? SCRAPLING_MINIMUM_PYTHON_VERSION;
  const label = params.label ?? "scrapling-fetch";
  const envOverrides = params.envOverrides ?? SCRAPLING_PYTHON_ENV_OVERRIDES;
  const [major, minor] = minimumVersion.split(".").map(Number);
  const minimum = { major, minor, patch: 0 };
  let best = null;
  for (const candidate of resolvePythonCandidates(env, process.platform, envOverrides)) {
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
      `No supported Python interpreter found for ${label}; requires Python >= ${minimumVersion}.`,
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

function installPythonRequirementsRuntime(params, env = process.env) {
  const runtimeDir = path.join(resolveRuntimesRoot(env), params.id);
  const venvDir = path.join(runtimeDir, "venv");
  const python = resolveBestPython(env, {
    label: params.id,
    minimumVersion: params.minimumVersion,
    envOverrides: params.envOverrides,
  });
  const lockedPackages = readLockedRequirements(params.requirementsLockPath);
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
  if (params.verifyScript) {
    runOrThrow(venvPython, ["-c", params.verifyScript], { env });
  }
  return {
    state: "healthy",
    python: python.command,
    pythonVersion: python.version.text,
    venvDir,
    installedAt: new Date().toISOString(),
    packages: [...lockedPackages],
  };
}

function installCoreSkillsRuntime(env = process.env) {
  return installPythonRequirementsRuntime(
    {
      id: "core-skills",
      minimumVersion: CORE_SKILLS_MINIMUM_PYTHON_VERSION,
      envOverrides: CORE_SKILLS_PYTHON_ENV_OVERRIDES,
      requirementsLockPath: CORE_SKILLS_REQUIREMENTS_LOCK,
      verifyScript: "import yaml; print('ok')",
    },
    env,
  );
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

function installNotebookLmRuntime(env = process.env) {
  const runtimeDir = path.join(resolveRuntimesRoot(env), "notebooklm-mcp-cli");
  const venvDir = path.join(runtimeDir, "venv");
  const python = resolveBestPython(env, {
    label: "notebooklm-mcp-cli",
    minimumVersion: NOTEBOOKLM_MINIMUM_PYTHON_VERSION,
    envOverrides: NOTEBOOKLM_PYTHON_ENV_OVERRIDES,
  });
  mkdirSync(runtimeDir, { recursive: true });
  const venvPython = resolveScraplingVenvPython(venvDir);
  if (!existsSync(venvPython)) {
    runOrThrow(python.command, ["-m", "venv", venvDir], { env });
  }
  runOrThrow(venvPython, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], {
    env,
  });
  const packageSpec = `notebooklm-mcp-cli==${NOTEBOOKLM_MCP_CLI_VERSION}`;
  runOrThrow(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", packageSpec], {
    env,
  });
  const binPath = resolveNotebookLmVenvBin(venvDir, "nlm");
  const mcpBinPath = resolveNotebookLmVenvBin(venvDir, "notebooklm-mcp");
  if (!existsSync(binPath)) {
    throw new Error(`notebooklm-mcp-cli nlm binary missing after install: ${binPath}`);
  }
  if (!existsSync(mcpBinPath)) {
    throw new Error(`notebooklm-mcp-cli MCP binary missing after install: ${mcpBinPath}`);
  }
  const version =
    runOrThrow(venvPython, ["-c", "import notebooklm_tools; print(notebooklm_tools.__version__)"], {
      env,
    }).stdout.trim() || NOTEBOOKLM_MCP_CLI_VERSION;
  return {
    state: "healthy",
    version,
    package: packageSpec,
    python: python.command,
    pythonVersion: python.version.text,
    venvDir,
    binPath,
    mcpBinPath,
    installedAt: new Date().toISOString(),
  };
}

function supportsOpenAiWhisperRuntime(platform = process.platform, arch = process.arch) {
  return platform === "darwin" && arch === "arm64";
}

function installOpenAiWhisperRuntime(env = process.env) {
  if (!supportsOpenAiWhisperRuntime()) {
    throw new Error("skill-openai-whisper requires macOS Apple Silicon.");
  }
  return installPythonRequirementsRuntime(
    {
      id: "skill-openai-whisper",
      minimumVersion: CORE_SKILLS_MINIMUM_PYTHON_VERSION,
      envOverrides: CORE_SKILLS_PYTHON_ENV_OVERRIDES,
      requirementsLockPath: OPENAI_WHISPER_REQUIREMENTS_LOCK,
      verifyScript: "import mlx_whisper; print('ok')",
    },
    env,
  );
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

function resolveN8nRuntimeBin(runtimeDir) {
  return process.platform === "win32"
    ? path.join(runtimeDir, "node_modules", ".bin", "n8n.cmd")
    : path.join(runtimeDir, "node_modules", ".bin", "n8n");
}

function hasN8nChineseLocalization(distDir) {
  const assetsDir = path.join(distDir, "assets");
  if (!existsSync(assetsDir)) {
    return false;
  }
  for (const entry of readdirSync(assetsDir)) {
    if (/^zh-CN[-.].*\.js$/u.test(entry)) {
      return true;
    }
    if (!entry.endsWith(".js")) {
      continue;
    }
    const asset = readFileSync(path.join(assetsDir, entry), "utf8");
    if (/工作流|凭证|执行|运行|节点/u.test(asset)) {
      return true;
    }
  }
  return false;
}

function downloadN8nChineseEditorUiArchive(url, archivePath, env = process.env) {
  try {
    runOrThrow("curl", ["-fL", url, "-o", archivePath], { env });
    return;
  } catch (curlError) {
    if (process.platform !== "win32") {
      throw curlError;
    }
  }
  runOrThrow(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ProgressPreference='SilentlyContinue'; " +
        `Invoke-WebRequest -Uri ${JSON.stringify(url)} -OutFile ${JSON.stringify(archivePath)}`,
    ],
    { env },
  );
}

function findExtractedN8nEditorUiDistDir(rootDir, maxDepth = 4) {
  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth) {
      continue;
    }
    if (
      path.basename(current.dir) === "dist" &&
      existsSync(path.join(current.dir, "index.html")) &&
      existsSync(path.join(current.dir, "assets"))
    ) {
      return current.dir;
    }
    for (const entry of readdirSync(current.dir)) {
      const child = path.join(current.dir, entry);
      if (statSync(child).isDirectory()) {
        queue.push({ dir: child, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

export function applyN8nChineseEditorUi(runtimeDir, env = process.env) {
  const distDir = resolveN8nEditorUiDistDir(runtimeDir);
  const url = resolveN8nChineseEditorUiUrl();
  const base = {
    locale: "zh-CN",
    source: N8N_ZH_CN_EDITOR_UI_SOURCE,
    url,
  };
  if (!existsSync(distDir)) {
    throw new Error(`n8n editor-ui dist missing after install: ${distDir}`);
  }
  if (hasN8nChineseLocalization(distDir)) {
    return {
      ...base,
      state: "healthy",
      installedAt: new Date().toISOString(),
      reason: "already-installed",
    };
  }

  const parentDir = path.dirname(distDir);
  const tempRoot = mkdtempSync(path.join(parentDir, ".crawclaw-i18n-"));
  const archivePath = path.join(tempRoot, "editor-ui.tar.gz");
  const extractDir = path.join(tempRoot, "extract");
  const backupDir = path.join(parentDir, ".crawclaw-editor-ui-dist-backup");
  mkdirSync(extractDir, { recursive: true });
  try {
    downloadN8nChineseEditorUiArchive(url, archivePath, env);
    runOrThrow("tar", ["-xzf", archivePath, "-C", extractDir], { env });
    const extractedDistDir = findExtractedN8nEditorUiDistDir(extractDir);
    if (!extractedDistDir) {
      throw new Error("downloaded n8n zh-CN editor-ui archive did not contain a dist directory");
    }
    if (!hasN8nChineseLocalization(extractedDistDir)) {
      throw new Error("downloaded n8n zh-CN editor-ui archive did not contain zh-CN localization");
    }

    rmSync(backupDir, { recursive: true, force: true });
    renameSync(distDir, backupDir);
    try {
      renameSync(extractedDistDir, distDir);
    } catch (error) {
      rmSync(distDir, { recursive: true, force: true });
      renameSync(backupDir, distDir);
      throw error;
    }
    rmSync(backupDir, { recursive: true, force: true });
    const metadata = {
      ...base,
      state: "healthy",
      installedAt: new Date().toISOString(),
      n8nVersion: N8N_VERSION,
    };
    writeFileSync(
      resolveN8nEditorUiLocalizationMetadataPath(distDir),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
    return metadata;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function installN8nRuntime(env = process.env) {
  const runtimeDir = path.join(resolveRuntimesRoot(env), "n8n");
  mkdirSync(runtimeDir, { recursive: true });
  const nestedEnv = createNestedNpmInstallEnv(env);
  const packageSpec = `n8n@${N8N_VERSION}`;
  const npmRunner = resolveNpmRunner({
    env: nestedEnv,
    npmArgs: createLocalPrefixNpmInstallArgs(runtimeDir, packageSpec),
  });
  runNpmInstallWithRetry(npmRunner.command, npmRunner.args, {
    env: npmRunner.env ?? nestedEnv,
    shell: npmRunner.shell,
    windowsVerbatimArguments: npmRunner.windowsVerbatimArguments,
  });
  const binPath = resolveN8nRuntimeBin(runtimeDir);
  if (!existsSync(binPath)) {
    throw new Error(`n8n binary missing after install: ${binPath}`);
  }
  let localization;
  try {
    localization = applyN8nChineseEditorUi(runtimeDir, env);
  } catch (error) {
    localization = {
      locale: "zh-CN",
      source: N8N_ZH_CN_EDITOR_UI_SOURCE,
      url: resolveN8nChineseEditorUiUrl(),
      state: "unavailable",
      error: normalizeErrorMessage(error),
      installedAt: new Date().toISOString(),
    };
  }
  return {
    state: "healthy",
    version: N8N_VERSION,
    package: packageSpec,
    installDir: runtimeDir,
    binPath,
    localization,
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
  const installers = [
    { id: "browser", installer: installBrowserRuntime },
    { id: "core-skills", installer: installCoreSkillsRuntime },
    { id: "n8n", installer: installN8nRuntime },
    { id: "open-websearch", installer: installOpenWebSearchRuntime },
    { id: "scrapling-fetch", installer: installScraplingRuntime },
    { id: "notebooklm-mcp-cli", installer: installNotebookLmRuntime },
  ];
  if (supportsOpenAiWhisperRuntime()) {
    installers.push({ id: "skill-openai-whisper", installer: installOpenAiWhisperRuntime });
  }
  return installers;
}

export function listManagedPluginRuntimeInstallPlan(params = {}) {
  const platform = params.platform ?? process.platform;
  const arch = params.arch ?? process.arch;
  return [
    {
      id: "browser",
      installTime: true,
      npmPackage: `pinchtab@${PINCHTAB_VERSION}`,
    },
    {
      id: "core-skills",
      installTime: true,
      python: {
        candidates: resolvePlatformPythonCandidates(platform),
        envOverrides: [...CORE_SKILLS_PYTHON_ENV_OVERRIDES],
        minimumVersion: CORE_SKILLS_MINIMUM_PYTHON_VERSION,
        requirementsLockPath: CORE_SKILLS_REQUIREMENTS_LOCK,
      },
    },
    {
      id: "n8n",
      installTime: true,
      localization: {
        locale: "zh-CN",
        source: N8N_ZH_CN_EDITOR_UI_SOURCE,
        url: resolveN8nChineseEditorUiUrl(),
      },
      npmPackage: `n8n@${N8N_VERSION}`,
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
    {
      id: "notebooklm-mcp-cli",
      installTime: true,
      python: {
        candidates: resolvePlatformPythonCandidates(platform),
        envOverrides: [...NOTEBOOKLM_PYTHON_ENV_OVERRIDES],
        minimumVersion: NOTEBOOKLM_MINIMUM_PYTHON_VERSION,
        package: `notebooklm-mcp-cli==${NOTEBOOKLM_MCP_CLI_VERSION}`,
      },
    },
    {
      id: "skill-openai-whisper",
      installTime: supportsOpenAiWhisperRuntime(platform, arch),
      platforms: ["darwin:arm64"],
      python: {
        candidates: resolvePlatformPythonCandidates(platform),
        envOverrides: [...CORE_SKILLS_PYTHON_ENV_OVERRIDES],
        minimumVersion: CORE_SKILLS_MINIMUM_PYTHON_VERSION,
        requirementsLockPath: OPENAI_WHISPER_REQUIREMENTS_LOCK,
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
