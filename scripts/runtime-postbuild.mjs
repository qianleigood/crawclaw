import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyBundledPluginMetadata } from "./copy-bundled-plugin-metadata.mjs";
import { copyPluginSdkRootAlias } from "./copy-plugin-sdk-root-alias.mjs";
import { writeTextFileIfChanged } from "./runtime-postbuild-shared.mjs";
import { stageBundledPluginRuntimeDeps } from "./stage-bundled-plugin-runtime-deps.mjs";
import { stageBundledPluginRuntime } from "./stage-bundled-plugin-runtime.mjs";
import { writeOfficialChannelCatalog } from "./write-official-channel-catalog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_RUNTIME_ALIAS_PATTERN = /^(?<base>.+\.(?:runtime|contract))-[A-Za-z0-9_-]+\.js$/u;
const ROOT_HELP_CHUNK_PATTERN = /^root-help-[A-Za-z0-9_-]+\.js$/u;

function listStaticRuntimeMigrationAssets(params = {}) {
  const rootDir = params.rootDir ?? ROOT;
  const migrationsDir = path.join(rootDir, "src", "memory", "runtime", "migrations");
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+_.*\.sql$/u.test(entry.name))
    .map((entry) => ({
      src: path.join("src", "memory", "runtime", "migrations", entry.name),
      dest: path.join("dist", "migrations", entry.name),
    }))
    .toSorted((left, right) => left.dest.localeCompare(right.dest));
}

/**
 * Copy static (non-transpiled) runtime assets that are referenced by their
 * source-relative path inside bundled extension code.
 *
 * Each entry: { src: repo-root-relative source, dest: dist-relative dest }
 */
export const STATIC_EXTENSION_ASSETS = [
  // acpx MCP proxy — co-deployed alongside the acpx index bundle so that
  // `path.resolve(dirname(import.meta.url), "mcp-proxy.mjs")` resolves correctly
  // at runtime (see extensions/acpx/src/runtime-internals/mcp-agent-command.ts).
  {
    src: "extensions/acpx/src/runtime-internals/mcp-proxy.mjs",
    dest: "dist/extensions/acpx/mcp-proxy.mjs",
  },
  // diffs viewer runtime bundle — co-deployed inside the plugin package so the
  // built bundle can resolve `./assets/viewer-runtime.js` from dist.
  {
    src: "extensions/diffs/assets/viewer-runtime.js",
    dest: "dist/extensions/diffs/assets/viewer-runtime.js",
  },
  // Scrapling sidecar is a Python runtime asset resolved next to the bundled
  // plugin entry at runtime.
  {
    src: "extensions/scrapling-fetch/python/scrapling_sidecar.py",
    dest: "dist/extensions/scrapling-fetch/python/scrapling_sidecar.py",
  },
  // Sqlite runtime migrations are runtime data, not transpiled modules. Ship
  // them under dist/ so published installs do not rely on src/ being present.
  ...listStaticRuntimeMigrationAssets(),
];

export function listStaticExtensionAssetOutputs(params = {}) {
  const assets = params.assets ?? STATIC_EXTENSION_ASSETS;
  return assets
    .map(({ dest }) => dest.replace(/\\/g, "/"))
    .toSorted((left, right) => left.localeCompare(right));
}

export function copyStaticExtensionAssets(params = {}) {
  const rootDir = params.rootDir ?? ROOT;
  const assets = params.assets ?? STATIC_EXTENSION_ASSETS;
  const fsImpl = params.fs ?? fs;
  const warn = params.warn ?? console.warn;
  for (const { src, dest } of assets) {
    const srcPath = path.join(rootDir, src);
    const destPath = path.join(rootDir, dest);
    if (fsImpl.existsSync(srcPath)) {
      fsImpl.mkdirSync(path.dirname(destPath), { recursive: true });
      fsImpl.copyFileSync(srcPath, destPath);
    } else {
      warn(`[runtime-postbuild] static asset not found, skipping: ${src}`);
    }
  }
}

export function writeStableRootRuntimeAliases(params = {}) {
  const rootDir = params.rootDir ?? ROOT;
  const distDir = path.join(rootDir, "dist");
  const fsImpl = params.fs ?? fs;
  let entries = [];
  try {
    entries = fsImpl.readdirSync(distDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = entry.name.match(ROOT_RUNTIME_ALIAS_PATTERN);
    if (!match?.groups?.base) {
      continue;
    }
    const aliasPath = path.join(distDir, `${match.groups.base}.js`);
    writeTextFileIfChanged(aliasPath, `export * from "./${entry.name}";\n`);
  }
}

export function writeStableRootHelpAlias(params = {}) {
  const rootDir = params.rootDir ?? ROOT;
  const distDir = path.join(rootDir, "dist");
  const fsImpl = params.fs ?? fs;
  let entries = [];
  try {
    entries = fsImpl.readdirSync(distDir, { withFileTypes: true });
  } catch {
    return;
  }

  const match = entries.find((entry) => entry.isFile() && ROOT_HELP_CHUNK_PATTERN.test(entry.name));
  if (!match) {
    return;
  }

  const aliasPath = path.join(distDir, "cli", "program", "root-help.js");
  writeTextFileIfChanged(aliasPath, `export * from "../../${match.name}";\n`);
}

export function runRuntimePostBuild(params = {}) {
  copyPluginSdkRootAlias(params);
  copyBundledPluginMetadata(params);
  writeOfficialChannelCatalog(params);
  stageBundledPluginRuntimeDeps(params);
  stageBundledPluginRuntime(params);
  writeStableRootRuntimeAliases(params);
  writeStableRootHelpAlias(params);
  copyStaticExtensionAssets(params);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runRuntimePostBuild();
}
