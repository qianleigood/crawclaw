import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCrawClawPackageRootSync } from "../infra/crawclaw-root.js";
import { resolveBundledPluginsDir } from "./bundled-dir.js";
import {
  getPackageManifestMetadata,
  loadPluginManifest,
  PLUGIN_MANIFEST_FILENAME,
  type CrawClawPackageManifest,
  type PackageManifest,
  type PluginManifest,
} from "./manifest.js";

const CURRENT_MODULE_PATH = fileURLToPath(import.meta.url);
const CRAWCLAW_PACKAGE_ROOT =
  resolveCrawClawPackageRootSync({
    cwd: path.dirname(CURRENT_MODULE_PATH),
    ...(process.argv[1] ? { argv1: process.argv[1] } : {}),
    moduleUrl: import.meta.url,
  }) ?? fileURLToPath(new URL("../..", import.meta.url));
const RUNNING_FROM_BUILT_ARTIFACT = CURRENT_MODULE_PATH.includes(`${path.sep}dist${path.sep}`);
const PUBLIC_SURFACE_SOURCE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs", ".cts", ".cjs"] as const;
const RUNTIME_SIDECAR_ARTIFACTS = new Set([
  "helper-api.js",
  "light-runtime-api.js",
  "runtime-api.js",
  "thread-bindings-runtime.js",
]);
type BundledPluginPathPair = {
  source: string;
  built: string;
};

export type BundledPluginMetadata = {
  dirName: string;
  idHint: string;
  source: BundledPluginPathPair;
  publicSurfaceArtifacts?: readonly string[];
  runtimeSidecarArtifacts?: readonly string[];
  packageName?: string;
  packageVersion?: string;
  packageDescription?: string;
  packageManifest?: CrawClawPackageManifest;
  manifest: PluginManifest;
};

const bundledPluginMetadataCache = new Map<string, readonly BundledPluginMetadata[]>();

export function clearBundledPluginMetadataCache(): void {
  bundledPluginMetadataCache.clear();
}

function trimString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function rewriteEntryToBuiltPath(entry: string | undefined): string | undefined {
  if (!entry) {
    return undefined;
  }
  const normalized = entry.replace(/^\.\//u, "");
  return normalized.replace(/\.[^.]+$/u, ".js");
}

function readPackageManifest(pluginDir: string): PackageManifest | undefined {
  const packagePath = path.join(pluginDir, "package.json");
  if (!fs.existsSync(packagePath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf-8")) as PackageManifest;
  } catch {
    return undefined;
  }
}

function deriveIdHint(params: {
  entryPath: string;
  manifestId: string;
  packageName?: string;
  hasMultipleExtensions: boolean;
}): string {
  const base = path.basename(params.entryPath, path.extname(params.entryPath));
  if (!params.hasMultipleExtensions) {
    return params.manifestId;
  }
  const packageName = trimString(params.packageName);
  if (!packageName) {
    return `${params.manifestId}/${base}`;
  }
  const unscoped = packageName.includes("/")
    ? (packageName.split("/").pop() ?? packageName)
    : packageName;
  return `${unscoped}/${base}`;
}

function isTopLevelPublicSurfaceSource(name: string): boolean {
  if (
    !PUBLIC_SURFACE_SOURCE_EXTENSIONS.includes(
      path.extname(name) as (typeof PUBLIC_SURFACE_SOURCE_EXTENSIONS)[number],
    )
  ) {
    return false;
  }
  if (name.startsWith(".")) {
    return false;
  }
  if (name.startsWith("test-")) {
    return false;
  }
  if (name.includes(".test-")) {
    return false;
  }
  if (name.endsWith(".d.ts")) {
    return false;
  }
  return !/(\.test|\.spec)(\.[cm]?[jt]s)$/u.test(name);
}

function collectTopLevelPublicSurfaceArtifacts(params: {
  pluginDir: string;
  sourceEntry: string;
}): readonly string[] | undefined {
  const excluded = new Set([path.basename(params.sourceEntry)]);
  const artifacts = fs
    .readdirSync(params.pluginDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(isTopLevelPublicSurfaceSource)
    .filter((entry) => !excluded.has(entry))
    .map((entry) => rewriteEntryToBuiltPath(entry))
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .toSorted((left, right) => left.localeCompare(right));
  return artifacts.length > 0 ? artifacts : undefined;
}

function collectRuntimeSidecarArtifacts(
  publicSurfaceArtifacts: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!publicSurfaceArtifacts) {
    return undefined;
  }
  const artifacts = publicSurfaceArtifacts.filter((artifact) =>
    RUNTIME_SIDECAR_ARTIFACTS.has(artifact),
  );
  return artifacts.length > 0 ? artifacts : undefined;
}

function resolveBundledPluginScanDir(packageRoot: string): string | undefined {
  const sourceDir = path.join(packageRoot, "extensions");
  const builtDir = path.join(packageRoot, "dist", "extensions");
  if (RUNNING_FROM_BUILT_ARTIFACT) {
    if (fs.existsSync(builtDir)) {
      return builtDir;
    }
  }
  if (fs.existsSync(sourceDir)) {
    return sourceDir;
  }
  if (fs.existsSync(builtDir)) {
    return builtDir;
  }
  return undefined;
}

function collectBundledPluginMetadataForPackageRoot(
  packageRoot: string,
): readonly BundledPluginMetadata[] {
  const scanDir = resolveBundledPluginScanDir(packageRoot);
  if (!scanDir || !fs.existsSync(scanDir)) {
    return [];
  }

  const entries: BundledPluginMetadata[] = [];
  for (const dirName of fs
    .readdirSync(scanDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right))) {
    const pluginDir = path.join(scanDir, dirName);
    const manifestResult = loadPluginManifest(pluginDir, false);
    if (!manifestResult.ok) {
      continue;
    }

    const packageJson = readPackageManifest(pluginDir);
    const packageManifest = getPackageManifestMetadata(packageJson);
    const nativeOnly = Boolean(manifestResult.manifest.native);
    if (!nativeOnly) {
      continue;
    }
    const sourceEntry = `./${PLUGIN_MANIFEST_FILENAME}`;
    const builtEntry = PLUGIN_MANIFEST_FILENAME;

    const publicSurfaceArtifacts = nativeOnly
      ? undefined
      : collectTopLevelPublicSurfaceArtifacts({
          pluginDir,
          sourceEntry,
        });
    const runtimeSidecarArtifacts = collectRuntimeSidecarArtifacts(publicSurfaceArtifacts);
    entries.push({
      dirName,
      idHint: deriveIdHint({
        entryPath: sourceEntry,
        manifestId: manifestResult.manifest.id,
        packageName: trimString(packageJson?.name),
        hasMultipleExtensions: false,
      }),
      source: {
        source: sourceEntry,
        built: builtEntry,
      },
      ...(publicSurfaceArtifacts ? { publicSurfaceArtifacts } : {}),
      ...(runtimeSidecarArtifacts ? { runtimeSidecarArtifacts } : {}),
      ...(trimString(packageJson?.name) ? { packageName: trimString(packageJson?.name) } : {}),
      ...(trimString(packageJson?.version)
        ? { packageVersion: trimString(packageJson?.version) }
        : {}),
      ...(trimString(packageJson?.description)
        ? { packageDescription: trimString(packageJson?.description) }
        : {}),
      ...(packageManifest ? { packageManifest } : {}),
      manifest: manifestResult.manifest,
    });
  }

  return entries;
}

export function listBundledPluginMetadata(params?: {
  rootDir?: string;
}): readonly BundledPluginMetadata[] {
  const rootDir = path.resolve(params?.rootDir ?? CRAWCLAW_PACKAGE_ROOT);
  const cacheKey = JSON.stringify({
    rootDir,
    runningFromBuiltArtifact: RUNNING_FROM_BUILT_ARTIFACT,
  });
  const cached = bundledPluginMetadataCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const entries = Object.freeze(collectBundledPluginMetadataForPackageRoot(rootDir));
  bundledPluginMetadataCache.set(cacheKey, entries);
  return entries;
}

export function findBundledPluginMetadataById(
  pluginId: string,
  params?: { rootDir?: string },
): BundledPluginMetadata | undefined {
  return listBundledPluginMetadata(params).find((entry) => entry.manifest.id === pluginId);
}

export function resolveBundledPluginWorkspaceSourcePath(params: {
  rootDir: string;
  pluginId: string;
}): string | null {
  const metadata = findBundledPluginMetadataById(params.pluginId, { rootDir: params.rootDir });
  if (!metadata) {
    return null;
  }
  return path.resolve(params.rootDir, "extensions", metadata.dirName);
}

export function resolveBundledPluginGeneratedPath(
  rootDir: string,
  entry: BundledPluginPathPair | undefined,
): string | null {
  if (!entry) {
    return null;
  }
  const candidates = [entry.built, entry.source]
    .filter(
      (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
    )
    .map((candidate) => path.resolve(rootDir, candidate));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveBundledPluginPublicSurfacePath(params: {
  rootDir: string;
  dirName: string;
  artifactBasename: string;
  env?: NodeJS.ProcessEnv;
  bundledPluginsDir?: string;
}): string | null {
  const artifactBasename = params.artifactBasename.replace(/^\.\//u, "");
  if (!artifactBasename) {
    return null;
  }

  const explicitBundledPluginsDir =
    params.bundledPluginsDir ?? resolveBundledPluginsDir(params.env ?? process.env);
  if (explicitBundledPluginsDir) {
    const explicitPluginDir = path.resolve(explicitBundledPluginsDir, params.dirName);
    const explicitBuiltCandidate = path.join(explicitPluginDir, artifactBasename);
    if (fs.existsSync(explicitBuiltCandidate)) {
      return explicitBuiltCandidate;
    }

    const sourceBaseName = artifactBasename.replace(/\.js$/u, "");
    for (const ext of PUBLIC_SURFACE_SOURCE_EXTENSIONS) {
      const sourceCandidate = path.join(explicitPluginDir, `${sourceBaseName}${ext}`);
      if (fs.existsSync(sourceCandidate)) {
        return sourceCandidate;
      }
    }
  }

  for (const candidate of [
    path.resolve(params.rootDir, "dist", "extensions", params.dirName, artifactBasename),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const sourceBaseName = artifactBasename.replace(/\.js$/u, "");
  for (const ext of PUBLIC_SURFACE_SOURCE_EXTENSIONS) {
    const sourceCandidate = path.resolve(
      params.rootDir,
      "extensions",
      params.dirName,
      `${sourceBaseName}${ext}`,
    );
    if (fs.existsSync(sourceCandidate)) {
      return sourceCandidate;
    }
  }

  return null;
}
