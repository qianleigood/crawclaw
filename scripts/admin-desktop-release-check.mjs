#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAdminDesktopRuntimeStagePaths } from "./admin-desktop-stage-runtime.mjs";

const __filename = fileURLToPath(import.meta.url);
const rootDir = resolve(dirname(__filename), "..");

export function assertAdminDesktopReleaseInputs(params = {}) {
  const checkRootDir = params.rootDir ?? rootDir;
  const rootPackagePath = join(checkRootDir, "package.json");
  const desktopPackagePath = join(checkRootDir, "apps", "crawclaw-admin-desktop", "package.json");
  const builderConfigPath = join(
    checkRootDir,
    "apps",
    "crawclaw-admin-desktop",
    "electron-builder.yml",
  );
  const adminDistIndexPath = join(checkRootDir, "apps", "crawclaw-admin", "dist", "index.html");
  const runtimePaths = resolveAdminDesktopRuntimeStagePaths(checkRootDir);

  const rootPackage = readJson(rootPackagePath);
  assertFile(desktopPackagePath, "desktop package.json");
  const desktopPackage = readJson(desktopPackagePath);
  assertEqual(
    desktopPackage.version,
    rootPackage.version,
    "desktop package version must match root package version",
  );

  const builderConfig = readText(builderConfigPath);
  assertIncludes(builderConfig, "appId: ai.crawclaw.desktop", "Electron Builder app id");
  assertIncludes(builderConfig, "productName: CrawClaw Desktop", "Electron Builder product name");
  assertIncludes(builderConfig, "from: .runtime/crawclaw", "embedded runtime resource");
  assertIncludes(
    builderConfig,
    "from: .runtime/crawclaw/node_modules",
    "embedded runtime node_modules resource",
  );
  assertIncludes(builderConfig, "- dmg", "macOS dmg target");
  assertIncludes(builderConfig, "- zip", "macOS zip target");
  assertIncludes(builderConfig, "- nsis", "Windows nsis target");
  assertIncludes(builderConfig, "- AppImage", "Linux AppImage target");

  assertFile(adminDistIndexPath, "admin frontend dist/index.html");
  assertExecutableFile(runtimePaths.runtimeEntryPath, "embedded CrawClaw runtime entrypoint");
  assertExecutableFile(runtimePaths.nodePath, "embedded Node runtime");
  assertFile(
    join(runtimePaths.runtimeRoot, "node_modules", "chalk", "package.json"),
    "embedded CrawClaw runtime dependencies",
  );
  assertBundledPluginRuntimes(runtimePaths.runtimeRoot, "embedded");
  assertRuntimeSmoke(runtimePaths, params.spawnSyncImpl ?? spawnSync);
  for (const packagedRuntime of findPackagedRuntimeRoots(checkRootDir)) {
    assertExecutableFile(packagedRuntime.runtimeEntryPath, "packaged CrawClaw runtime entrypoint");
    assertExecutableFile(packagedRuntime.nodePath, "packaged Node runtime");
    assertFile(
      join(packagedRuntime.runtimeRoot, "node_modules", "chalk", "package.json"),
      "packaged CrawClaw runtime dependencies",
    );
    assertBundledPluginRuntimes(packagedRuntime.runtimeRoot, "packaged");
    assertRuntimeSmoke(packagedRuntime, params.spawnSyncImpl ?? spawnSync);
  }
  if (params.checkGeneratedPaths !== false) {
    assertNoDirtyGeneratedPaths(checkRootDir, params.spawnSyncImpl ?? spawnSync);
  }
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  assertFile(path, path);
  return readFileSync(path, "utf-8");
}

function assertFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

function assertExecutableFile(path, label) {
  assertFile(path, label);
  if (process.platform === "win32") {
    return;
  }
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new Error(`${label} is not executable: ${path}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertIncludes(source, value, label) {
  if (!source.includes(value)) {
    throw new Error(`Missing ${label}: ${value}`);
  }
}

function assertRuntimeSmoke(runtimePaths, spawnSyncImpl) {
  assertRuntimeCommand(runtimePaths, ["gateway", "--help"], spawnSyncImpl, "gateway --help");
  assertRuntimeCommand(
    runtimePaths,
    ["gateway", "run", "--allow-unconfigured", "--help"],
    spawnSyncImpl,
    "gateway run --allow-unconfigured --help",
  );
}

function assertRuntimeCommand(runtimePaths, args, spawnSyncImpl, label) {
  const smokeRoot = mkdtempSync(join(tmpdir(), "crawclaw-desktop-release-smoke-"));
  try {
    writeFileSync(join(smokeRoot, "crawclaw.json"), "{}\n", "utf8");
    const result = spawnSyncImpl(runtimePaths.nodePath, [runtimePaths.runtimeEntryPath, ...args], {
      cwd: runtimePaths.runtimeRoot,
      env: {
        ...process.env,
        CRAWCLAW_CONFIG_PATH: join(smokeRoot, "crawclaw.json"),
        CRAWCLAW_STATE_DIR: smokeRoot,
        CRAWCLAW_PLUGIN_RUNTIMES_DIR: join(runtimePaths.runtimeRoot, "runtimes"),
        HOME: smokeRoot,
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
      `Embedded CrawClaw runtime smoke failed for ${label} with ${suffix}${detail ? `: ${detail}` : ""}`,
    );
  } finally {
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}

function assertBundledPluginRuntimes(runtimeRoot, label) {
  assertFile(
    join(runtimeRoot, "runtimes", "manifest.json"),
    `${label} managed plugin runtime manifest`,
  );
  assertFile(
    join(
      runtimeRoot,
      "runtimes",
      "node-24",
      "scrapling-fetch",
      "venv",
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "python.exe" : "python",
    ),
    `${label} scrapling-fetch runtime`,
  );
  assertFile(
    join(
      runtimeRoot,
      "runtimes",
      "node-24",
      "notebooklm-mcp-cli",
      "venv",
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "notebooklm-mcp.exe" : "notebooklm-mcp",
    ),
    `${label} notebooklm-mcp-cli runtime`,
  );
  assertMissing(join(runtimeRoot, "runtimes", "node-24", "n8n"), `${label} optional n8n runtime`);
  assertMissing(
    join(runtimeRoot, "runtimes", "node-24", "skill-openai-whisper"),
    `${label} optional Whisper runtime`,
  );
  assertMissing(
    join(runtimeRoot, "runtimes", "node-24", "qwen3-tts"),
    `${label} optional Qwen3-TTS runtime`,
  );
}

function assertMissing(path, label) {
  if (existsSync(path)) {
    throw new Error(`${label} should not be bundled: ${path}`);
  }
}

function findPackagedRuntimeRoots(checkRootDir) {
  const outDir = join(checkRootDir, "apps", "crawclaw-admin-desktop", "out");
  if (!existsSync(outDir)) {
    return [];
  }
  const roots = [];
  walk(outDir, 0, (filePath) => {
    if (!filePath.endsWith(join("runtime", "crawclaw", "crawclaw.mjs"))) {
      return;
    }
    const runtimeRoot = dirname(filePath);
    roots.push({
      runtimeRoot,
      runtimeEntryPath: filePath,
      nodePath: join(runtimeRoot, "bin", process.platform === "win32" ? "node.exe" : "node"),
    });
  });
  return roots;
}

function walk(dir, depth, onFile) {
  if (depth > 8) {
    return;
  }
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      walk(filePath, depth + 1, onFile);
    } else if (stats.isFile()) {
      onFile(filePath);
    }
  }
}

function assertNoDirtyGeneratedPaths(checkRootDir, spawnSyncImpl) {
  const generatedPaths = [
    "apps/crawclaw-admin/dist",
    "apps/crawclaw-admin-desktop/dist",
    "apps/crawclaw-admin-desktop/out",
  ];
  const result = spawnSyncImpl("git", ["status", "--porcelain", "--", ...generatedPaths], {
    cwd: checkRootDir,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to inspect generated path status");
  }
  if (result.stdout.trim()) {
    throw new Error(`Generated desktop build paths have tracked changes:\n${result.stdout}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  assertAdminDesktopReleaseInputs();
  console.log("Admin desktop release check passed");
}
