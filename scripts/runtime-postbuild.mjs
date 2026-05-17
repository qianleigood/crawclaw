import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyBundledPluginMetadata } from "./copy-bundled-plugin-metadata.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  // Qwen3-TTS MLX sidecar is a Python runtime asset resolved next to the
  // bundled plugin entry at runtime.
  {
    src: "extensions/qwen3-tts/python/qwen3_tts_sidecar.py",
    dest: "dist/extensions/qwen3-tts/python/qwen3_tts_sidecar.py",
  },
  {
    src: "extensions/qwen3-tts/python/qwen3_tts_python_sidecar.py",
    dest: "dist/extensions/qwen3-tts/python/qwen3_tts_python_sidecar.py",
  },
  {
    src: "extensions/searxng/runtime/settings.yml",
    dest: "dist/extensions/searxng/runtime/settings.yml",
  },
  {
    src: "extensions/searxng/runtime/source.lock.json",
    dest: "dist/extensions/searxng/runtime/source.lock.json",
  },
  {
    src: "extensions/searxng/runtime/NOTICE.md",
    dest: "dist/extensions/searxng/runtime/NOTICE.md",
  },
  {
    src: "extensions/searxng/runtime/LICENSE",
    dest: "dist/extensions/searxng/runtime/LICENSE",
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

export function runRuntimePostBuild(params = {}) {
  copyBundledPluginMetadata(params);
  copyStaticExtensionAssets(params);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runRuntimePostBuild();
}
