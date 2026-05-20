import fs from "node:fs";
import path from "node:path";
import type { CrawClawConfig } from "../config/config.js";
import { applyMergePatch } from "../config/merge-patch.js";
import { openBoundaryFileSync } from "../infra/boundary-file-read.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { BundleMcpServerConfig } from "../plugins/bundle-mcp.js";
import {
  normalizePluginsConfig,
  resolveEffectivePluginActivationState,
} from "../plugins/config-state.js";
import { loadPluginManifestRegistry } from "../plugins/manifest-registry.js";
import { isRecord } from "../utils.js";
import { applyPiCompactionSettingsFromConfig } from "./pi-settings.js";

const log = createSubsystemLogger("runtime-project-settings");

export const DEFAULT_RUNTIME_PROJECT_SETTINGS_POLICY = "sanitize";
export const SANITIZED_PROJECT_SETTINGS_KEYS = ["shellPath", "shellCommandPrefix"] as const;

export type RuntimeProjectSettingsPolicy = "trusted" | "sanitize" | "ignore";

type RuntimeSettingsSnapshot = Record<string, unknown> & {
  compaction?: {
    reserveTokens?: number;
    keepRecentTokens?: number;
    enabled?: boolean;
  };
  mcpServers?: Record<string, BundleMcpServerConfig>;
};
export type RuntimeSettingsManager = {
  getGlobalSettings: () => RuntimeSettingsSnapshot;
  getProjectSettings: () => RuntimeSettingsSnapshot;
  getCompactionReserveTokens: () => number;
  getCompactionKeepRecentTokens: () => number;
  applyOverrides: (overrides: {
    compaction: {
      reserveTokens?: number;
      keepRecentTokens?: number;
    };
  }) => void;
  setCompactionEnabled: (enabled: boolean) => void;
};

function createInMemorySettingsManager(settings: RuntimeSettingsSnapshot): RuntimeSettingsManager {
  let snapshot: RuntimeSettingsSnapshot = { ...settings };
  return {
    getGlobalSettings: () => snapshot,
    getProjectSettings: () => ({}),
    getCompactionReserveTokens: () =>
      typeof snapshot.compaction?.reserveTokens === "number"
        ? snapshot.compaction.reserveTokens
        : 0,
    getCompactionKeepRecentTokens: () =>
      typeof snapshot.compaction?.keepRecentTokens === "number"
        ? snapshot.compaction.keepRecentTokens
        : 0,
    applyOverrides: (overrides) => {
      snapshot = applyMergePatch(snapshot, overrides) as RuntimeSettingsSnapshot;
    },
    setCompactionEnabled: (enabled) => {
      snapshot = applyMergePatch(snapshot, { compaction: { enabled } }) as RuntimeSettingsSnapshot;
    },
  };
}

function sanitizeRuntimeSettingsSnapshot(
  settings: RuntimeSettingsSnapshot,
): RuntimeSettingsSnapshot {
  const sanitized = { ...settings };
  // Never allow plugin or workspace-local settings to override shell execution behavior.
  for (const key of SANITIZED_PROJECT_SETTINGS_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

function sanitizeProjectSettings(settings: RuntimeSettingsSnapshot): RuntimeSettingsSnapshot {
  return sanitizeRuntimeSettingsSnapshot(settings);
}

function loadBundleSettingsFile(params: {
  rootDir: string;
  relativePath: string;
}): RuntimeSettingsSnapshot | null {
  const absolutePath = path.join(params.rootDir, params.relativePath);
  const opened = openBoundaryFileSync({
    absolutePath,
    rootPath: params.rootDir,
    boundaryLabel: "plugin root",
    rejectHardlinks: true,
  });
  if (!opened.ok) {
    log.warn(`skipping unsafe bundle settings file: ${absolutePath}`);
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(opened.fd, "utf-8")) as unknown;
    if (!isRecord(raw)) {
      log.warn(`skipping bundle settings file with non-object JSON: ${absolutePath}`);
      return null;
    }
    return sanitizeRuntimeSettingsSnapshot(raw as RuntimeSettingsSnapshot);
  } catch (error) {
    log.warn(`failed to parse bundle settings file ${absolutePath}: ${String(error)}`);
    return null;
  } finally {
    fs.closeSync(opened.fd);
  }
}

export function loadEnabledBundleRuntimeSettingsSnapshot(params: {
  cwd: string;
  cfg?: CrawClawConfig;
}): RuntimeSettingsSnapshot {
  const workspaceDir = params.cwd.trim();
  if (!workspaceDir) {
    return {};
  }
  const registry = loadPluginManifestRegistry({
    workspaceDir,
    config: params.cfg,
  });
  if (registry.plugins.length === 0) {
    return {};
  }

  const normalizedPlugins = normalizePluginsConfig(params.cfg?.plugins);
  let snapshot: RuntimeSettingsSnapshot = {};

  for (const record of registry.plugins) {
    const settingsFiles = record.settingsFiles ?? [];
    if (record.format !== "bundle" || settingsFiles.length === 0) {
      continue;
    }
    const activationState = resolveEffectivePluginActivationState({
      id: record.id,
      origin: record.origin,
      config: normalizedPlugins,
    });
    if (!activationState.activated) {
      continue;
    }
    for (const relativePath of settingsFiles) {
      const bundleSettings = loadBundleSettingsFile({
        rootDir: record.rootDir,
        relativePath,
      });
      if (!bundleSettings) {
        continue;
      }
      snapshot = applyMergePatch(snapshot, bundleSettings) as RuntimeSettingsSnapshot;
    }
  }

  return snapshot;
}

export function resolveRuntimeProjectSettingsPolicy(
  cfg?: CrawClawConfig,
): RuntimeProjectSettingsPolicy {
  const raw = cfg?.agents?.defaults?.runtime?.projectSettingsPolicy;
  if (raw === "trusted" || raw === "sanitize" || raw === "ignore") {
    return raw;
  }
  return DEFAULT_RUNTIME_PROJECT_SETTINGS_POLICY;
}

export function buildRuntimeSettingsSnapshot(params: {
  globalSettings: RuntimeSettingsSnapshot;
  pluginSettings?: RuntimeSettingsSnapshot;
  projectSettings: RuntimeSettingsSnapshot;
  policy: RuntimeProjectSettingsPolicy;
}): RuntimeSettingsSnapshot {
  const effectiveProjectSettings =
    params.policy === "ignore"
      ? {}
      : params.policy === "sanitize"
        ? sanitizeProjectSettings(params.projectSettings)
        : params.projectSettings;
  const withPluginSettings = applyMergePatch(
    params.globalSettings,
    sanitizeRuntimeSettingsSnapshot(params.pluginSettings ?? {}),
  ) as RuntimeSettingsSnapshot;
  return applyMergePatch(withPluginSettings, effectiveProjectSettings) as RuntimeSettingsSnapshot;
}

export function createRuntimeSettingsManager(params: {
  cwd: string;
  agentDir: string;
  cfg?: CrawClawConfig;
}): RuntimeSettingsManager {
  void params.agentDir;
  const fileSettingsManager = createInMemorySettingsManager({});
  const policy = resolveRuntimeProjectSettingsPolicy(params.cfg);
  const pluginSettings = loadEnabledBundleRuntimeSettingsSnapshot({
    cwd: params.cwd,
    cfg: params.cfg,
  });
  const hasPluginSettings = Object.keys(pluginSettings).length > 0;
  if (policy === "trusted" && !hasPluginSettings) {
    return fileSettingsManager;
  }
  const settings = buildRuntimeSettingsSnapshot({
    globalSettings: fileSettingsManager.getGlobalSettings(),
    pluginSettings,
    projectSettings: fileSettingsManager.getProjectSettings(),
    policy,
  });
  return createInMemorySettingsManager(settings);
}

export function createPreparedRuntimeSettingsManager(params: {
  cwd: string;
  agentDir: string;
  cfg?: CrawClawConfig;
}): RuntimeSettingsManager {
  const settingsManager = createRuntimeSettingsManager(params);
  applyPiCompactionSettingsFromConfig({
    settingsManager,
    cfg: params.cfg,
  });
  return settingsManager;
}
