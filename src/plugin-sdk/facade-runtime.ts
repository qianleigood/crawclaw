import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type CrawClawConfig } from "../config/config.js";
import { applyPluginAutoEnable } from "../config/plugin-auto-enable.js";
import { openBoundaryFileSync } from "../infra/boundary-file-read.js";
import { resolveBundledPluginsDir } from "../plugins/bundled-dir.js";
import {
  normalizePluginsConfig,
  resolveEffectivePluginActivationState,
} from "../plugins/config-state.js";
import {
  loadPluginManifestRegistry,
  type PluginManifestRecord,
} from "../plugins/manifest-registry.js";
import {
  resolveLoaderPackageRoot,
} from "../plugins/sdk-alias.js";
import {
  ALWAYS_ALLOWED_RUNTIME_DIR_NAMES,
  createLazyFacadeArrayValue,
  createLazyFacadeObjectValue,
  getOrCreateFacadeJitiLoader,
  resolveFacadeModuleLocation,
} from "./facade-runtime-helpers.js";
export { createLazyFacadeArrayValue, createLazyFacadeObjectValue } from "./facade-runtime-helpers.js";

const CRAWCLAW_PACKAGE_ROOT =
  resolveLoaderPackageRoot({
    modulePath: fileURLToPath(import.meta.url),
    moduleUrl: import.meta.url,
  }) ?? fileURLToPath(new URL("../..", import.meta.url));
const CURRENT_MODULE_PATH = fileURLToPath(import.meta.url);
const EMPTY_FACADE_BOUNDARY_CONFIG: CrawClawConfig = {};
const jitiLoaders = new Map<string, ReturnType<typeof getOrCreateFacadeJitiLoader>>();
const loadedFacadeModules = new Map<string, unknown>();
const loadedFacadePluginIds = new Set<string>();
let cachedBoundaryRawConfig: CrawClawConfig | undefined;
let cachedBoundaryResolvedConfig:
  | {
      rawConfig: CrawClawConfig;
      config: CrawClawConfig;
      normalizedPluginsConfig: ReturnType<typeof normalizePluginsConfig>;
      sourceNormalizedPluginsConfig: ReturnType<typeof normalizePluginsConfig>;
      autoEnabledReasons: Record<string, string[]>;
    }
  | undefined;

function getJiti(modulePath: string) {
  return getOrCreateFacadeJitiLoader({
    modulePath,
    processArgv1: process.argv[1],
    importMetaUrl: import.meta.url,
    cache: jitiLoaders,
  });
}

function readFacadeBoundaryConfigSafely(): CrawClawConfig {
  try {
    const config = loadConfig();
    return config && typeof config === "object" ? config : EMPTY_FACADE_BOUNDARY_CONFIG;
  } catch {
    return EMPTY_FACADE_BOUNDARY_CONFIG;
  }
}

function getFacadeBoundaryResolvedConfig() {
  const rawConfig = readFacadeBoundaryConfigSafely();
  if (cachedBoundaryResolvedConfig && cachedBoundaryRawConfig === rawConfig) {
    return cachedBoundaryResolvedConfig;
  }

  const autoEnabled = applyPluginAutoEnable({
    config: rawConfig,
    env: process.env,
  });
  const config = autoEnabled.config;
  const resolved = {
    rawConfig,
    config,
    normalizedPluginsConfig: normalizePluginsConfig(config?.plugins),
    sourceNormalizedPluginsConfig: normalizePluginsConfig(rawConfig?.plugins),
    autoEnabledReasons: autoEnabled.autoEnabledReasons,
  };
  cachedBoundaryRawConfig = rawConfig;
  cachedBoundaryResolvedConfig = resolved;
  return resolved;
}

function resolveBundledPluginManifestRecordByDirName(dirName: string): PluginManifestRecord | null {
  const { config } = getFacadeBoundaryResolvedConfig();
  return (
    loadPluginManifestRegistry({
      config,
      cache: true,
    }).plugins.find(
      (plugin) => plugin.origin === "bundled" && path.basename(plugin.rootDir) === dirName,
    ) ?? null
  );
}

function resolveTrackedFacadePluginId(dirName: string): string {
  return resolveBundledPluginManifestRecordByDirName(dirName)?.id ?? dirName;
}

function resolveBundledPluginPublicSurfaceAccess(params: {
  dirName: string;
  artifactBasename: string;
}): { allowed: boolean; pluginId?: string; reason?: string } {
  if (
    params.artifactBasename === "runtime-api.js" &&
    ALWAYS_ALLOWED_RUNTIME_DIR_NAMES.has(params.dirName)
  ) {
    return {
      allowed: true,
      pluginId: params.dirName,
    };
  }

  const manifestRecord = resolveBundledPluginManifestRecordByDirName(params.dirName);
  if (!manifestRecord) {
    return {
      allowed: false,
      reason: `no bundled plugin manifest found for ${params.dirName}`,
    };
  }
  const {
    rawConfig,
    config,
    normalizedPluginsConfig,
    sourceNormalizedPluginsConfig,
    autoEnabledReasons,
  } = getFacadeBoundaryResolvedConfig();
  const activationState = resolveEffectivePluginActivationState({
    id: manifestRecord.id,
    origin: manifestRecord.origin,
    config: normalizedPluginsConfig,
    rootConfig: config,
    enabledByDefault: manifestRecord.enabledByDefault,
    sourceConfig: sourceNormalizedPluginsConfig,
    sourceRootConfig: rawConfig,
    autoEnabledReason: autoEnabledReasons[manifestRecord.id]?.[0],
  });
  if (activationState.enabled) {
    return {
      allowed: true,
      pluginId: manifestRecord.id,
    };
  }

  return {
    allowed: false,
    pluginId: manifestRecord.id,
    reason: activationState.reason ?? "plugin runtime is not activated",
  };
}

export function loadBundledPluginPublicSurfaceModuleSync<T extends object>(params: {
  dirName: string;
  artifactBasename: string;
}): T {
  const location = resolveFacadeModuleLocation({
    ...params,
    bundledPluginsDir: resolveBundledPluginsDir() ?? undefined,
    currentModulePath: CURRENT_MODULE_PATH,
    packageRoot: CRAWCLAW_PACKAGE_ROOT,
  });
  if (!location) {
    throw new Error(
      `Unable to resolve bundled plugin public surface ${params.dirName}/${params.artifactBasename}`,
    );
  }
  const cached = loadedFacadeModules.get(location.modulePath);
  if (cached) {
    return cached as T;
  }

  const opened = openBoundaryFileSync({
    absolutePath: location.modulePath,
    rootPath: location.boundaryRoot,
    boundaryLabel:
      location.boundaryRoot === CRAWCLAW_PACKAGE_ROOT
        ? "CrawClaw package root"
        : "bundled plugin directory",
    rejectHardlinks: false,
  });
  if (!opened.ok) {
    throw new Error(
      `Unable to open bundled plugin public surface ${params.dirName}/${params.artifactBasename}`,
      { cause: opened.error },
    );
  }
  fs.closeSync(opened.fd);

  // Place a sentinel object in the cache *before* the Jiti load begins.
  // If a transitive dependency of the loaded module re-enters this function
  // for the same modulePath (circular facade reference), it will receive the
  // sentinel instead of recursing infinitely.  Once the real module finishes
  // loading, Object.assign() back-fills the sentinel so any references
  // captured during the circular load phase see the final exports.
  const sentinel = {} as T;
  loadedFacadeModules.set(location.modulePath, sentinel);

  let loaded: T;
  try {
    // Track the owning plugin once module evaluation begins. Facade top-level
    // code may have already executed even if the module later throws.
    loadedFacadePluginIds.add(resolveTrackedFacadePluginId(params.dirName));
    loaded = getJiti(location.modulePath)(location.modulePath) as T;
    Object.assign(sentinel, loaded);
  } catch (err) {
    loadedFacadeModules.delete(location.modulePath);
    throw err;
  }

  return sentinel;
}

export function canLoadActivatedBundledPluginPublicSurface(params: {
  dirName: string;
  artifactBasename: string;
}): boolean {
  return resolveBundledPluginPublicSurfaceAccess(params).allowed;
}

export function loadActivatedBundledPluginPublicSurfaceModuleSync<T extends object>(params: {
  dirName: string;
  artifactBasename: string;
}): T {
  const access = resolveBundledPluginPublicSurfaceAccess(params);
  if (!access.allowed) {
    const pluginLabel = access.pluginId ?? params.dirName;
    throw new Error(
      `Bundled plugin public surface access blocked for "${pluginLabel}" via ${params.dirName}/${params.artifactBasename}: ${access.reason ?? "plugin runtime is not activated"}`,
    );
  }
  return loadBundledPluginPublicSurfaceModuleSync<T>(params);
}

export function tryLoadActivatedBundledPluginPublicSurfaceModuleSync<T extends object>(params: {
  dirName: string;
  artifactBasename: string;
}): T | null {
  const access = resolveBundledPluginPublicSurfaceAccess(params);
  if (!access.allowed) {
    return null;
  }
  return loadBundledPluginPublicSurfaceModuleSync<T>(params);
}

export function listImportedBundledPluginFacadeIds(): string[] {
  return [...loadedFacadePluginIds].toSorted((left, right) => left.localeCompare(right));
}

export function resetFacadeRuntimeStateForTest(): void {
  loadedFacadeModules.clear();
  loadedFacadePluginIds.clear();
  jitiLoaders.clear();
  cachedBoundaryRawConfig = undefined;
  cachedBoundaryResolvedConfig = undefined;
}
