import fs from "node:fs";
import path from "node:path";
import { openBoundaryFileSync } from "../infra/boundary-file-read.js";
import { resolveUserPath } from "../utils.js";
import { detectBundleManifestFormat, loadBundleManifest } from "./bundle-manifest.js";
import {
  PLUGIN_MANIFEST_FILENAME,
  getPackageManifestMetadata,
  loadPluginManifest,
  type PluginManifest,
  type CrawClawPackageManifest,
  type PackageManifest,
} from "./manifest.js";
import { formatPosixMode, isPathInside, safeRealpathSync, safeStatSync } from "./path-safety.js";
import { resolvePluginCacheInputs, resolvePluginSourceRoots } from "./roots.js";
import type { PluginBundleFormat, PluginDiagnostic, PluginFormat, PluginOrigin } from "./types.js";

export type PluginCandidate = {
  idHint: string;
  source: string;
  rootDir: string;
  origin: PluginOrigin;
  format?: PluginFormat;
  bundleFormat?: PluginBundleFormat;
  workspaceDir?: string;
  packageName?: string;
  packageVersion?: string;
  packageDescription?: string;
  packageDir?: string;
  packageManifest?: CrawClawPackageManifest;
  bundledManifest?: PluginManifest;
  bundledManifestPath?: string;
};

export type PluginDiscoveryResult = {
  candidates: PluginCandidate[];
  diagnostics: PluginDiagnostic[];
};

const discoveryCache = new Map<string, { expiresAt: number; result: PluginDiscoveryResult }>();

// Keep a short cache window to collapse bursty reloads during startup flows.
const DEFAULT_DISCOVERY_CACHE_MS = 1000;

export function clearPluginDiscoveryCache(): void {
  discoveryCache.clear();
}

function resolveDiscoveryCacheMs(env: NodeJS.ProcessEnv): number {
  const raw =
    env.CRAWCLAW_PLUGIN_DISCOVERY_CACHE_MS?.trim() ??
    env.CRAWCLAW_PLUGIN_DISCOVERY_CACHE_MS?.trim();
  if (raw === "" || raw === "0") {
    return 0;
  }
  if (!raw) {
    return DEFAULT_DISCOVERY_CACHE_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_DISCOVERY_CACHE_MS;
  }
  return Math.max(0, parsed);
}

function shouldUseDiscoveryCache(env: NodeJS.ProcessEnv): boolean {
  const disabled =
    env.CRAWCLAW_DISABLE_PLUGIN_DISCOVERY_CACHE?.trim() ??
    env.CRAWCLAW_DISABLE_PLUGIN_DISCOVERY_CACHE?.trim();
  if (disabled) {
    return false;
  }
  return resolveDiscoveryCacheMs(env) > 0;
}

function buildDiscoveryCacheKey(params: {
  workspaceDir?: string;
  extraPaths?: string[];
  ownershipUid?: number | null;
  env: NodeJS.ProcessEnv;
}): string {
  const { roots, loadPaths } = resolvePluginCacheInputs({
    workspaceDir: params.workspaceDir,
    loadPaths: params.extraPaths,
    env: params.env,
  });
  const workspaceKey = roots.workspace ?? "";
  const configExtensionsRoot = roots.global ?? "";
  const ownershipUid = params.ownershipUid ?? currentUid();
  return `${workspaceKey}::${ownershipUid ?? "none"}::${configExtensionsRoot}::${JSON.stringify(loadPaths)}`;
}

function currentUid(overrideUid?: number | null): number | null {
  if (overrideUid !== undefined) {
    return overrideUid;
  }
  if (process.platform === "win32") {
    return null;
  }
  if (typeof process.getuid !== "function") {
    return null;
  }
  return process.getuid();
}

export type CandidateBlockReason =
  | "source_escapes_root"
  | "path_stat_failed"
  | "path_world_writable"
  | "path_suspicious_ownership";

type CandidateBlockIssue = {
  reason: CandidateBlockReason;
  sourcePath: string;
  rootPath: string;
  targetPath: string;
  sourceRealPath?: string;
  rootRealPath?: string;
  modeBits?: number;
  foundUid?: number;
  expectedUid?: number;
};

type DiscoverablePluginOrigin = Exclude<PluginOrigin, "bundled">;

function checkSourceEscapesRoot(params: {
  source: string;
  rootDir: string;
}): CandidateBlockIssue | null {
  const sourceRealPath = safeRealpathSync(params.source);
  const rootRealPath = safeRealpathSync(params.rootDir);
  if (!sourceRealPath || !rootRealPath) {
    return null;
  }
  if (isPathInside(rootRealPath, sourceRealPath)) {
    return null;
  }
  return {
    reason: "source_escapes_root",
    sourcePath: params.source,
    rootPath: params.rootDir,
    targetPath: params.source,
    sourceRealPath,
    rootRealPath,
  };
}

function checkPathStatAndPermissions(params: {
  source: string;
  rootDir: string;
  uid: number | null;
}): CandidateBlockIssue | null {
  if (process.platform === "win32") {
    return null;
  }
  const pathsToCheck = [params.rootDir, params.source];
  const seen = new Set<string>();
  for (const targetPath of pathsToCheck) {
    const normalized = path.resolve(targetPath);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    const stat = safeStatSync(targetPath);
    if (!stat) {
      return {
        reason: "path_stat_failed",
        sourcePath: params.source,
        rootPath: params.rootDir,
        targetPath,
      };
    }
    const modeBits = stat.mode & 0o777;
    if ((modeBits & 0o002) !== 0) {
      return {
        reason: "path_world_writable",
        sourcePath: params.source,
        rootPath: params.rootDir,
        targetPath,
        modeBits,
      };
    }
    if (
      params.uid !== null &&
      typeof stat.uid === "number" &&
      stat.uid !== params.uid &&
      stat.uid !== 0
    ) {
      return {
        reason: "path_suspicious_ownership",
        sourcePath: params.source,
        rootPath: params.rootDir,
        targetPath,
        foundUid: stat.uid,
        expectedUid: params.uid,
      };
    }
  }
  return null;
}

function findCandidateBlockIssue(params: {
  source: string;
  rootDir: string;
  ownershipUid?: number | null;
}): CandidateBlockIssue | null {
  const escaped = checkSourceEscapesRoot({
    source: params.source,
    rootDir: params.rootDir,
  });
  if (escaped) {
    return escaped;
  }
  return checkPathStatAndPermissions({
    source: params.source,
    rootDir: params.rootDir,
    uid: currentUid(params.ownershipUid),
  });
}

function formatCandidateBlockMessage(issue: CandidateBlockIssue): string {
  if (issue.reason === "source_escapes_root") {
    return `blocked plugin candidate: source escapes plugin root (${issue.sourcePath} -> ${issue.sourceRealPath}; root=${issue.rootRealPath})`;
  }
  if (issue.reason === "path_stat_failed") {
    return `blocked plugin candidate: cannot stat path (${issue.targetPath})`;
  }
  if (issue.reason === "path_world_writable") {
    return `blocked plugin candidate: world-writable path (${issue.targetPath}, mode=${formatPosixMode(issue.modeBits ?? 0)})`;
  }
  return `blocked plugin candidate: suspicious ownership (${issue.targetPath}, uid=${issue.foundUid}, expected uid=${issue.expectedUid} or root)`;
}

function isUnsafePluginCandidate(params: {
  source: string;
  rootDir: string;
  diagnostics: PluginDiagnostic[];
  ownershipUid?: number | null;
}): boolean {
  const issue = findCandidateBlockIssue({
    source: params.source,
    rootDir: params.rootDir,
    ownershipUid: params.ownershipUid,
  });
  if (!issue) {
    return false;
  }
  params.diagnostics.push({
    level: "warn",
    source: issue.targetPath,
    message: formatCandidateBlockMessage(issue),
  });
  return true;
}

function shouldIgnoreScannedDirectory(dirName: string): boolean {
  const normalized = dirName.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.endsWith(".bak")) {
    return true;
  }
  if (normalized.includes(".backup-")) {
    return true;
  }
  if (normalized.includes(".disabled")) {
    return true;
  }
  return false;
}

function readPackageManifest(dir: string): PackageManifest | null {
  const manifestPath = path.join(dir, "package.json");
  const opened = openBoundaryFileSync({
    absolutePath: manifestPath,
    rootPath: dir,
    boundaryLabel: "plugin package directory",
    rejectHardlinks: true,
  });
  if (!opened.ok) {
    return null;
  }
  try {
    const raw = fs.readFileSync(opened.fd, "utf-8");
    return JSON.parse(raw) as PackageManifest;
  } catch {
    return null;
  } finally {
    fs.closeSync(opened.fd);
  }
}

function addCandidate(params: {
  candidates: PluginCandidate[];
  diagnostics: PluginDiagnostic[];
  seen: Set<string>;
  idHint: string;
  source: string;
  rootDir: string;
  origin: DiscoverablePluginOrigin;
  format?: PluginFormat;
  bundleFormat?: PluginBundleFormat;
  ownershipUid?: number | null;
  workspaceDir?: string;
  manifest?: PackageManifest | null;
  packageDir?: string;
  bundledManifest?: PluginManifest;
  bundledManifestPath?: string;
}) {
  const resolved = path.resolve(params.source);
  if (params.seen.has(resolved)) {
    return;
  }
  const resolvedRoot = safeRealpathSync(params.rootDir) ?? path.resolve(params.rootDir);
  if (
    isUnsafePluginCandidate({
      source: resolved,
      rootDir: resolvedRoot,
      diagnostics: params.diagnostics,
      ownershipUid: params.ownershipUid,
    })
  ) {
    return;
  }
  params.seen.add(resolved);
  const manifest = params.manifest ?? null;
  params.candidates.push({
    idHint: params.idHint,
    source: resolved,
    rootDir: resolvedRoot,
    origin: params.origin,
    format: params.format ?? "crawclaw",
    bundleFormat: params.bundleFormat,
    workspaceDir: params.workspaceDir,
    packageName: manifest?.name?.trim() || undefined,
    packageVersion: manifest?.version?.trim() || undefined,
    packageDescription: manifest?.description?.trim() || undefined,
    packageDir: params.packageDir,
    packageManifest: getPackageManifestMetadata(manifest ?? undefined),
    bundledManifest: params.bundledManifest,
    bundledManifestPath: params.bundledManifestPath,
  });
}

function discoverBundleInRoot(params: {
  rootDir: string;
  origin: DiscoverablePluginOrigin;
  ownershipUid?: number | null;
  workspaceDir?: string;
  candidates: PluginCandidate[];
  diagnostics: PluginDiagnostic[];
  seen: Set<string>;
}): "added" | "invalid" | "none" {
  const bundleFormat = detectBundleManifestFormat(params.rootDir);
  if (!bundleFormat) {
    return "none";
  }
  const bundleManifest = loadBundleManifest({
    rootDir: params.rootDir,
    bundleFormat,
    rejectHardlinks: true,
  });
  if (!bundleManifest.ok) {
    params.diagnostics.push({
      level: "error",
      message: bundleManifest.error,
      source: bundleManifest.manifestPath,
    });
    return "invalid";
  }
  addCandidate({
    candidates: params.candidates,
    diagnostics: params.diagnostics,
    seen: params.seen,
    idHint: bundleManifest.manifest.id,
    source: params.rootDir,
    rootDir: params.rootDir,
    origin: params.origin,
    format: "bundle",
    bundleFormat,
    ownershipUid: params.ownershipUid,
    workspaceDir: params.workspaceDir,
  });
  return "added";
}

function addNativeManifestCandidate(params: {
  rootDir: string;
  origin: DiscoverablePluginOrigin;
  ownershipUid?: number | null;
  workspaceDir?: string;
  candidates: PluginCandidate[];
  diagnostics: PluginDiagnostic[];
  seen: Set<string>;
  manifest?: PackageManifest | null;
}): boolean {
  const manifest = loadPluginManifest(params.rootDir, true);
  if (!manifest.ok || !manifest.manifest.native) {
    return false;
  }
  addCandidate({
    candidates: params.candidates,
    diagnostics: params.diagnostics,
    seen: params.seen,
    idHint: manifest.manifest.id,
    source: path.join(params.rootDir, PLUGIN_MANIFEST_FILENAME),
    rootDir: params.rootDir,
    origin: params.origin,
    format: "native",
    ownershipUid: params.ownershipUid,
    workspaceDir: params.workspaceDir,
    manifest: params.manifest,
    packageDir: params.rootDir,
  });
  return true;
}

function discoverInDirectory(params: {
  dir: string;
  origin: DiscoverablePluginOrigin;
  ownershipUid?: number | null;
  workspaceDir?: string;
  candidates: PluginCandidate[];
  diagnostics: PluginDiagnostic[];
  seen: Set<string>;
  skipDirectories?: Set<string>;
}) {
  if (!fs.existsSync(params.dir)) {
    return;
  }
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(params.dir, { withFileTypes: true });
  } catch (err) {
    params.diagnostics.push({
      level: "warn",
      message: `failed to read extensions dir: ${params.dir} (${String(err)})`,
      source: params.dir,
    });
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(params.dir, entry.name);
    if (!entry.isDirectory()) {
      continue;
    }
    if (params.skipDirectories?.has(entry.name)) {
      continue;
    }
    if (shouldIgnoreScannedDirectory(entry.name)) {
      continue;
    }

    const manifest = readPackageManifest(fullPath);
    if (
      addNativeManifestCandidate({
        rootDir: fullPath,
        origin: params.origin,
        ownershipUid: params.ownershipUid,
        workspaceDir: params.workspaceDir,
        candidates: params.candidates,
        diagnostics: params.diagnostics,
        seen: params.seen,
        manifest,
      })
    ) {
      continue;
    }

    const bundleDiscovery = discoverBundleInRoot({
      rootDir: fullPath,
      origin: params.origin,
      ownershipUid: params.ownershipUid,
      workspaceDir: params.workspaceDir,
      candidates: params.candidates,
      diagnostics: params.diagnostics,
      seen: params.seen,
    });
    if (bundleDiscovery === "added") {
      continue;
    }
  }
}

function discoverFromPath(params: {
  rawPath: string;
  origin: DiscoverablePluginOrigin;
  ownershipUid?: number | null;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
  candidates: PluginCandidate[];
  diagnostics: PluginDiagnostic[];
  seen: Set<string>;
}) {
  const resolved = resolveUserPath(params.rawPath, params.env);
  if (!fs.existsSync(resolved)) {
    params.diagnostics.push({
      level: "error",
      message: `plugin path not found: ${resolved}`,
      source: resolved,
    });
    return;
  }

  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    params.diagnostics.push({
      level: "error",
      message: `plugin path is not a supported plugin directory: ${resolved}`,
      source: resolved,
    });
    return;
  }

  if (stat.isDirectory()) {
    const manifest = readPackageManifest(resolved);
    if (
      addNativeManifestCandidate({
        rootDir: resolved,
        origin: params.origin,
        ownershipUid: params.ownershipUid,
        workspaceDir: params.workspaceDir,
        candidates: params.candidates,
        diagnostics: params.diagnostics,
        seen: params.seen,
        manifest,
      })
    ) {
      return;
    }

    const bundleDiscovery = discoverBundleInRoot({
      rootDir: resolved,
      origin: params.origin,
      ownershipUid: params.ownershipUid,
      workspaceDir: params.workspaceDir,
      candidates: params.candidates,
      diagnostics: params.diagnostics,
      seen: params.seen,
    });
    if (bundleDiscovery === "added") {
      return;
    }

    discoverInDirectory({
      dir: resolved,
      origin: params.origin,
      ownershipUid: params.ownershipUid,
      workspaceDir: params.workspaceDir,
      candidates: params.candidates,
      diagnostics: params.diagnostics,
      seen: params.seen,
    });
    return;
  }
}

export function discoverCrawClawPlugins(params: {
  workspaceDir?: string;
  extraPaths?: string[];
  ownershipUid?: number | null;
  cache?: boolean;
  env?: NodeJS.ProcessEnv;
}): PluginDiscoveryResult {
  const env = params.env ?? process.env;
  const cacheEnabled = params.cache !== false && shouldUseDiscoveryCache(env);
  const cacheKey = buildDiscoveryCacheKey({
    workspaceDir: params.workspaceDir,
    extraPaths: params.extraPaths,
    ownershipUid: params.ownershipUid,
    env,
  });
  if (cacheEnabled) {
    const cached = discoveryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  const candidates: PluginCandidate[] = [];
  const diagnostics: PluginDiagnostic[] = [];
  const seen = new Set<string>();
  const workspaceDir = params.workspaceDir?.trim();
  const workspaceRoot = workspaceDir ? resolveUserPath(workspaceDir, env) : undefined;
  const roots = resolvePluginSourceRoots({ workspaceDir: workspaceRoot, env });

  const extra = params.extraPaths ?? [];
  for (const extraPath of extra) {
    if (typeof extraPath !== "string") {
      continue;
    }
    const trimmed = extraPath.trim();
    if (!trimmed) {
      continue;
    }
    discoverFromPath({
      rawPath: trimmed,
      origin: "config",
      ownershipUid: params.ownershipUid,
      workspaceDir: workspaceDir?.trim() || undefined,
      env,
      candidates,
      diagnostics,
      seen,
    });
  }
  if (roots.workspace && workspaceRoot) {
    discoverInDirectory({
      dir: roots.workspace,
      origin: "workspace",
      ownershipUid: params.ownershipUid,
      workspaceDir: workspaceRoot,
      candidates,
      diagnostics,
      seen,
    });
  }

  // Keep auto-discovered global extensions behind explicit config and workspace plugins.
  // Users can still intentionally override via plugins.load.paths (origin=config).
  discoverInDirectory({
    dir: roots.global,
    origin: "global",
    ownershipUid: params.ownershipUid,
    candidates,
    diagnostics,
    seen,
  });

  const result = { candidates, diagnostics };
  if (cacheEnabled) {
    const ttl = resolveDiscoveryCacheMs(env);
    if (ttl > 0) {
      discoveryCache.set(cacheKey, { expiresAt: Date.now() + ttl, result });
    }
  }
  return result;
}
