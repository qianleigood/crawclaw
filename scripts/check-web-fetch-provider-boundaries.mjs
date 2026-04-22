#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  diffInventoryEntries,
  normalizeRepoPath,
  runBaselineInventoryCheck,
} from "./lib/guard-inventory-utils.mjs";
import { runAsScript } from "./lib/ts-guard-utils.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(
  repoRoot,
  "test",
  "fixtures",
  "web-fetch-provider-boundary-inventory.json",
);

const scanRoots = ["src"];
const scanExtensions = new Set([".ts", ".js", ".mjs", ".cjs"]);
const ignoredDirNames = new Set([
  ".artifacts",
  ".git",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "extensions",
  "node_modules",
]);

const bundledProviderPluginToFetchProvider = new Map([["scrapling-fetch", "scrapling"]]);

const providerIds = new Set(["scrapling", "shared"]);

const allowedGenericFiles = new Set([
  "src/secrets/runtime-web-tools.ts",
  "src/web-fetch/runtime.ts",
]);

const ignoredFiles = new Set([
  "src/plugins/contracts/loader.contract.test.ts",
  "src/plugins/contracts/registry.contract.test.ts",
  "src/plugins/web-fetch-providers.test.ts",
  "src/secrets/runtime-web-tools.test.ts",
]);

let webFetchProviderInventoryPromise;

async function walkFiles(rootDir) {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return out;
    }
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirNames.has(entry.name)) {
        continue;
      }
      out.push(...(await walkFiles(entryPath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!scanExtensions.has(path.extname(entry.name))) {
      continue;
    }
    out.push(entryPath);
  }
  return out;
}

function compareInventoryEntries(left, right) {
  return (
    left.provider.localeCompare(right.provider) ||
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.reason.localeCompare(right.reason)
  );
}

function pushEntry(inventory, entry) {
  if (!providerIds.has(entry.provider)) {
    throw new Error(`Unknown provider id in boundary inventory: ${entry.provider}`);
  }
  inventory.push(entry);
}

function scanWebFetchProviderRegistry(lines, relativeFile, inventory) {
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;

    const pluginMatch = line.match(/pluginId:\s*"([^"]+)"/);
    const providerFromPlugin = pluginMatch
      ? bundledProviderPluginToFetchProvider.get(pluginMatch[1])
      : undefined;
    if (providerFromPlugin) {
      pushEntry(inventory, {
        provider: providerFromPlugin,
        file: relativeFile,
        line: lineNumber,
        reason: "hardcodes bundled web fetch plugin ownership in core registry",
      });
    }

    const providerMatch = line.match(/id:\s*"(scrapling)"/);
    if (providerMatch) {
      pushEntry(inventory, {
        provider: providerMatch[1],
        file: relativeFile,
        line: lineNumber,
        reason: "hardcodes bundled web fetch provider id in core registry",
      });
    }
  }
}

function scanGenericCoreImports(lines, relativeFile, inventory) {
  if (allowedGenericFiles.has(relativeFile)) {
    return;
  }
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.includes("web-fetch-providers.js")) {
      pushEntry(inventory, {
        provider: "shared",
        file: relativeFile,
        line: lineNumber,
        reason: "imports bundled web fetch registry outside allowed generic plumbing",
      });
    }
  }
}

export async function collectWebFetchProviderBoundaryInventory() {
  if (!webFetchProviderInventoryPromise) {
    webFetchProviderInventoryPromise = (async () => {
      const inventory = [];
      const files = (
        await Promise.all(scanRoots.map(async (root) => await walkFiles(path.join(repoRoot, root))))
      )
        .flat()
        .toSorted((left, right) =>
          normalizeRepoPath(repoRoot, left).localeCompare(normalizeRepoPath(repoRoot, right)),
        );

      for (const filePath of files) {
        const relativeFile = normalizeRepoPath(repoRoot, filePath);
        if (ignoredFiles.has(relativeFile) || relativeFile.includes(".test.")) {
          continue;
        }
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split(/\r?\n/);

        if (relativeFile === "src/plugins/web-fetch-providers.ts") {
          scanWebFetchProviderRegistry(lines, relativeFile, inventory);
          continue;
        }

        scanGenericCoreImports(lines, relativeFile, inventory);
      }

      return inventory.toSorted(compareInventoryEntries);
    })();
  }
  return await webFetchProviderInventoryPromise;
}

export async function readExpectedInventory() {
  try {
    return JSON.parse(await fs.readFile(baselinePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function diffInventory(expected, actual) {
  return diffInventoryEntries(expected, actual, compareInventoryEntries);
}

function formatInventoryHuman(inventory) {
  if (inventory.length === 0) {
    return "No web fetch provider boundary inventory entries found.";
  }
  const lines = ["Web fetch provider boundary inventory:"];
  let activeProvider = "";
  for (const entry of inventory) {
    if (entry.provider !== activeProvider) {
      activeProvider = entry.provider;
      lines.push(`${activeProvider}:`);
    }
    lines.push(`  - ${entry.file}:${entry.line} ${entry.reason}`);
  }
  return lines.join("\n");
}

function formatEntry(entry) {
  return `${entry.provider} ${entry.file}:${entry.line} ${entry.reason}`;
}

export async function runWebFetchProviderBoundaryCheck(argv = process.argv.slice(2), io) {
  return await runBaselineInventoryCheck({
    argv,
    io,
    collectActual: collectWebFetchProviderBoundaryInventory,
    readExpected: readExpectedInventory,
    diffInventory,
    formatInventoryHuman,
    formatEntry,
  });
}

export async function main(argv = process.argv.slice(2), io) {
  const exitCode = await runWebFetchProviderBoundaryCheck(argv, io);
  if (!io && exitCode !== 0) {
    process.exit(exitCode);
  }
  return exitCode;
}

runAsScript(import.meta.url, main);
