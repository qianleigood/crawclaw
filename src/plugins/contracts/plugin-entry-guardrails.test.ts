import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_PLUGIN_ROOT_DIR,
  bundledPluginFile,
} from "../../../test/helpers/bundled-plugin-paths.js";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = resolve(ROOT_DIR, "..");
const EXTENSIONS_DIR = resolve(REPO_ROOT, BUNDLED_PLUGIN_ROOT_DIR);
const CORE_PLUGIN_ENTRY_IMPORT_RE =
  /import\s*\{[^}]*\bdefinePluginEntry\b[^}]*\}\s*from\s*"crawclaw\/plugin-sdk\/core"/;
const RUNTIME_ENTRY_HELPER_RE = /(^|\/)plugin-entry\.runtime\.[cm]?[jt]s$/;
const LEGACY_NATIVE_WRAPPER_RE = /\bdefinePluginEntry\b|\brunNativePluginOperation\b/;
const TARGET_NATIVE_PLUGIN_IDS = [
  "comfyui",
  "llm-task",
  "lobster",
  "open-websearch",
  "qwen3-tts",
  "scrapling-fetch",
] as const;

function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) {
      return collectFiles(path);
    }
    return [path];
  });
}

describe("plugin entry guardrails", () => {
  it("keeps bundled extension entry modules off direct definePluginEntry imports from core", () => {
    const failures: string[] = [];

    for (const entry of readdirSync(EXTENSIONS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const indexPath = resolve(EXTENSIONS_DIR, entry.name, "index.ts");
      try {
        const source = readFileSync(indexPath, "utf8");
        if (CORE_PLUGIN_ENTRY_IMPORT_RE.test(source)) {
          failures.push(bundledPluginFile(entry.name, "index.ts"));
        }
      } catch {
        // Skip extensions without index.ts entry modules.
      }
    }

    expect(failures).toEqual([]);
  });

  it("does not advertise runtime helper sidecars as bundled plugin entry extensions", () => {
    const failures: string[] = [];

    for (const entry of readdirSync(EXTENSIONS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packageJsonPath = resolve(EXTENSIONS_DIR, entry.name, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
          crawclaw?: { extensions?: unknown };
        };
        const extensions = Array.isArray(pkg.crawclaw?.extensions) ? pkg.crawclaw.extensions : [];
        if (
          extensions.some(
            (candidate) => typeof candidate === "string" && RUNTIME_ENTRY_HELPER_RE.test(candidate),
          )
        ) {
          failures.push(bundledPluginFile(entry.name, "package.json"));
        }
      } catch {
        // Skip directories without package metadata.
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps migrated bundled native plugins off TS entrypoint registration", () => {
    const failures: string[] = [];

    for (const pluginId of TARGET_NATIVE_PLUGIN_IDS) {
      const packageJsonPath = resolve(EXTENSIONS_DIR, pluginId, "package.json");
      const manifestPath = resolve(EXTENSIONS_DIR, pluginId, "crawclaw.plugin.json");
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        crawclaw?: { extensions?: unknown };
      };
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        id?: unknown;
        native?: { protocol?: unknown; schemaVersion?: unknown; bin?: unknown; command?: unknown };
      };
      const extensions = Array.isArray(pkg.crawclaw?.extensions) ? pkg.crawclaw.extensions : null;
      const hasNativeDiscovery =
        manifest.id === pluginId &&
        manifest.native?.protocol === "crawclaw-native-plugin-jsonrpc" &&
        manifest.native.schemaVersion === 1 &&
        (typeof manifest.native.bin === "string" || Array.isArray(manifest.native.command));

      if (!hasNativeDiscovery || extensions === null || extensions.length > 0) {
        failures.push(bundledPluginFile(pluginId, "package.json"));
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps migrated bundled native plugins free of legacy TS wrapper calls", () => {
    const failures: string[] = [];

    for (const pluginId of TARGET_NATIVE_PLUGIN_IDS) {
      const pluginDir = resolve(EXTENSIONS_DIR, pluginId);
      for (const filePath of collectFiles(pluginDir)) {
        if (!/\.[cm]?[jt]s$/.test(filePath)) {
          continue;
        }
        const source = readFileSync(filePath, "utf8");
        if (LEGACY_NATIVE_WRAPPER_RE.test(source)) {
          failures.push(bundledPluginFile(pluginId, filePath.slice(pluginDir.length + 1)));
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
