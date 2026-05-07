#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = resolve(dirname(__filename), "..");
const rootPackagePath = join(rootDir, "package.json");
const desktopPackagePath = join(rootDir, "apps", "crawclaw-admin-desktop", "package.json");
const builderConfigPath = join(rootDir, "apps", "crawclaw-admin-desktop", "electron-builder.yml");
const adminDistIndexPath = join(rootDir, "apps", "crawclaw-admin", "dist", "index.html");
const desktopRuntimeRoot = join(rootDir, "apps", "crawclaw-admin-desktop", ".runtime", "crawclaw");
const desktopRuntimeEntrypoint = join(desktopRuntimeRoot, "crawclaw.mjs");

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
assertIncludes(builderConfig, "to: runtime/crawclaw", "bundled CrawClaw runtime resource");
assertIncludes(builderConfig, "- dmg", "macOS dmg target");
assertIncludes(builderConfig, "- zip", "macOS zip target");
assertIncludes(builderConfig, "- nsis", "Windows nsis target");
assertIncludes(builderConfig, "- AppImage", "Linux AppImage target");

assertFile(adminDistIndexPath, "admin frontend dist/index.html");
assertFile(desktopRuntimeEntrypoint, "bundled CrawClaw runtime crawclaw.mjs");
assertFile(join(desktopRuntimeRoot, "dist", "index.js"), "bundled CrawClaw runtime dist/index.js");
assertBundledRuntimeCanPrintGatewayHelp();
assertNoDirtyGeneratedPaths();

console.log("CrawClaw Desktop release check passed");

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

function assertBundledRuntimeCanPrintGatewayHelp() {
  const result = spawnSync(process.execPath, [desktopRuntimeEntrypoint, "gateway", "--help"], {
    cwd: desktopRuntimeRoot,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Bundled CrawClaw runtime gateway --help failed:\n${result.stderr || result.stdout}`,
    );
  }
  if (!result.stdout.includes("gateway")) {
    throw new Error("Bundled CrawClaw runtime gateway --help did not print gateway help");
  }
}

function assertNoDirtyGeneratedPaths() {
  const generatedPaths = [
    "apps/crawclaw-admin/dist",
    "apps/crawclaw-admin-desktop/dist",
    "apps/crawclaw-admin-desktop/out",
  ];
  const result = spawnSync("git", ["status", "--porcelain", "--", ...generatedPaths], {
    cwd: rootDir,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to inspect generated path status");
  }
  if (result.stdout.trim()) {
    throw new Error(`Generated desktop build paths have tracked changes:\n${result.stdout}`);
  }
}
