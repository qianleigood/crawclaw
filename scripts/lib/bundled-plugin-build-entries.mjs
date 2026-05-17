import fs from "node:fs";
import path from "node:path";
import { BUNDLED_PLUGIN_ROOT_DIR, bundledDistPluginFile } from "./bundled-plugin-paths.mjs";
import { shouldBuildBundledCluster } from "./optional-bundled-clusters.mjs";

const CANONICAL_PLUGIN_MANIFEST_FILENAME = "crawclaw.plugin.json";

function resolvePluginManifestPath(pluginDir) {
  const manifestPath = path.join(pluginDir, CANONICAL_PLUGIN_MANIFEST_FILENAME);
  if (fs.existsSync(manifestPath)) {
    return manifestPath;
  }
  return null;
}

function readBundledPluginPackageJson(packageJsonPath) {
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return null;
  }
}

export function collectBundledPluginBuildEntries(params = {}) {
  const cwd = params.cwd ?? process.cwd();
  const env = params.env ?? process.env;
  const extensionsRoot = path.join(cwd, BUNDLED_PLUGIN_ROOT_DIR);
  const entries = [];

  for (const dirent of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }

    const pluginDir = path.join(extensionsRoot, dirent.name);
    const manifestPath = resolvePluginManifestPath(pluginDir);
    const hasManifest = manifestPath !== null;
    const packageJsonPath = path.join(pluginDir, "package.json");
    const packageJson = readBundledPluginPackageJson(packageJsonPath);
    if (!hasManifest) {
      continue;
    }
    if (!shouldBuildBundledCluster(dirent.name, env, { packageJson })) {
      continue;
    }

    entries.push({
      id: dirent.name,
      hasManifest,
      hasPackageJson: packageJson !== null,
      packageJson,
      sourceEntries: [],
    });
  }

  return entries;
}

export function listBundledPluginBuildEntries(params = {}) {
  void params;
  return {};
}

export function listBundledPluginPackArtifacts(params = {}) {
  const entries = collectBundledPluginBuildEntries(params);
  const artifacts = new Set();

  for (const { id, hasManifest, hasPackageJson, sourceEntries } of entries) {
    if (hasManifest) {
      artifacts.add(bundledDistPluginFile(id, CANONICAL_PLUGIN_MANIFEST_FILENAME));
    }
    if (hasPackageJson) {
      artifacts.add(bundledDistPluginFile(id, "package.json"));
    }
    for (const entry of sourceEntries) {
      const normalizedEntry = entry.replace(/^\.\//, "").replace(/\.[^.]+$/u, "");
      artifacts.add(bundledDistPluginFile(id, `${normalizedEntry}.js`));
    }
  }

  return [...artifacts].toSorted((left, right) => left.localeCompare(right));
}
