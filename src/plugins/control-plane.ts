import fs from "node:fs";
import { looksLikeLocalInstallSpec } from "../cli/install-spec.js";
import { buildNpmInstallRecordFields } from "../cli/npm-resolution.js";
import {
  applySlotSelectionForPlugin,
  buildPreferredClawHubSpec,
  decidePreferredClawHubFallback,
  resolveFileNpmSpecToLocalPath,
} from "../cli/plugins-command-helpers.js";
import {
  readConfigFileSnapshotForWrite,
  resolveConfigSnapshotHash,
  writeConfigFile,
} from "../config/config.js";
import type { CrawClawConfig } from "../config/config.js";
import type { PluginInstallRecord } from "../config/types.plugins.js";
import { resolveArchiveKind } from "../infra/archive.js";
import { parseClawHubPluginSpec } from "../infra/clawhub.js";
import { resolveUserPath } from "../utils.js";
import { formatClawHubSpecifier, installPluginFromClawHub } from "./clawhub.js";
import { enablePluginInConfig } from "./enable.js";
import { installPluginFromNpmSpec, installPluginFromPath } from "./install.js";
import { recordPluginInstall } from "./installs.js";
import { clearPluginManifestRegistryCache } from "./manifest-registry.js";
import { setPluginEnabledInConfig } from "./toggle-config.js";

export class PluginControlPlaneError extends Error {
  constructor(
    readonly kind: "invalid-request" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PluginControlPlaneError";
  }
}

export type PluginControlPlaneResult = {
  pluginId: string;
  warnings: string[];
  requiresRestart: true;
  installSource?: string;
};

function cloneWritableConfig(snapshot: {
  sourceConfig: CrawClawConfig;
  runtimeConfig: CrawClawConfig;
}): CrawClawConfig {
  return structuredClone(snapshot.sourceConfig ?? snapshot.runtimeConfig);
}

function assertBaseHashMatches(
  snapshot: Awaited<ReturnType<typeof readConfigFileSnapshotForWrite>>["snapshot"],
  baseHash?: string,
): void {
  if (baseHash === undefined) {
    return;
  }
  const currentHash = resolveConfigSnapshotHash(snapshot) ?? null;
  if (currentHash !== baseHash) {
    throw new PluginControlPlaneError(
      "invalid-request",
      "config changed since last load; re-run config.get and retry",
    );
  }
}

async function persistPluginConfigMutation(params: {
  baseHash?: string;
  mutate: (config: CrawClawConfig) =>
    | Promise<{
        pluginId: string;
        nextConfig: CrawClawConfig;
        warnings?: string[];
        installSource?: string;
      }>
    | {
        pluginId: string;
        nextConfig: CrawClawConfig;
        warnings?: string[];
        installSource?: string;
      };
}): Promise<PluginControlPlaneResult> {
  const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
  assertBaseHashMatches(snapshot, params.baseHash);
  const draft = cloneWritableConfig(snapshot);
  const result = await params.mutate(draft);
  await writeConfigFile(result.nextConfig, writeOptions);
  return {
    pluginId: result.pluginId,
    warnings: result.warnings ?? [],
    requiresRestart: true,
    ...(result.installSource ? { installSource: result.installSource } : {}),
  };
}

async function preflightConfigBaseHash(baseHash?: string): Promise<void> {
  if (baseHash === undefined) {
    return;
  }
  const { snapshot } = await readConfigFileSnapshotForWrite();
  assertBaseHashMatches(snapshot, baseHash);
}

function normalizeInstallSpec(raw: string): { raw: string; resolvedPath: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new PluginControlPlaneError("invalid-request", "plugin install spec required");
  }
  const fileSpec = resolveFileNpmSpecToLocalPath(trimmed);
  if (fileSpec && !fileSpec.ok) {
    throw new PluginControlPlaneError("invalid-request", fileSpec.error);
  }
  const normalized = fileSpec && fileSpec.ok ? fileSpec.path : trimmed;
  return {
    raw: trimmed,
    resolvedPath: resolveUserPath(normalized),
  };
}

async function installPluginArtifact(params: { raw: string; resolvedPath: string }): Promise<{
  pluginId: string;
  installSource: string;
  installRecord: PluginInstallRecord;
}> {
  if (fs.existsSync(params.resolvedPath)) {
    const result = await installPluginFromPath({
      path: params.resolvedPath,
    });
    if (!result.ok) {
      throw new PluginControlPlaneError("invalid-request", result.error);
    }
    clearPluginManifestRegistryCache();
    const installSource = resolveArchiveKind(params.resolvedPath) ? "archive" : "path";
    return {
      pluginId: result.pluginId,
      installSource,
      installRecord: {
        source: installSource,
        sourcePath: params.resolvedPath,
        installPath: result.targetDir,
        version: result.version,
      },
    };
  }

  if (
    looksLikeLocalInstallSpec(params.raw, [
      ".ts",
      ".js",
      ".mjs",
      ".cjs",
      ".tgz",
      ".tar.gz",
      ".tar",
      ".zip",
    ])
  ) {
    throw new PluginControlPlaneError("invalid-request", `Path not found: ${params.resolvedPath}`);
  }

  const explicitClawHub = parseClawHubPluginSpec(params.raw);
  if (explicitClawHub) {
    const result = await installPluginFromClawHub({ spec: params.raw });
    if (!result.ok) {
      throw new PluginControlPlaneError("invalid-request", result.error);
    }
    clearPluginManifestRegistryCache();
    return {
      pluginId: result.pluginId,
      installSource: "clawhub",
      installRecord: {
        source: "clawhub",
        spec: formatClawHubSpecifier({
          name: result.clawhub.clawhubPackage,
          version: result.clawhub.version,
        }),
        installPath: result.targetDir,
        version: result.version,
        integrity: result.clawhub.integrity,
        resolvedAt: result.clawhub.resolvedAt,
        clawhubUrl: result.clawhub.clawhubUrl,
        clawhubPackage: result.clawhub.clawhubPackage,
        clawhubFamily: result.clawhub.clawhubFamily,
        clawhubChannel: result.clawhub.clawhubChannel,
      },
    };
  }

  const preferredClawHubSpec = buildPreferredClawHubSpec(params.raw);
  if (preferredClawHubSpec) {
    const clawhubResult = await installPluginFromClawHub({ spec: preferredClawHubSpec });
    if (clawhubResult.ok) {
      clearPluginManifestRegistryCache();
      return {
        pluginId: clawhubResult.pluginId,
        installSource: "clawhub",
        installRecord: {
          source: "clawhub",
          spec: formatClawHubSpecifier({
            name: clawhubResult.clawhub.clawhubPackage,
            version: clawhubResult.clawhub.version,
          }),
          installPath: clawhubResult.targetDir,
          version: clawhubResult.version,
          integrity: clawhubResult.clawhub.integrity,
          resolvedAt: clawhubResult.clawhub.resolvedAt,
          clawhubUrl: clawhubResult.clawhub.clawhubUrl,
          clawhubPackage: clawhubResult.clawhub.clawhubPackage,
          clawhubFamily: clawhubResult.clawhub.clawhubFamily,
          clawhubChannel: clawhubResult.clawhub.clawhubChannel,
        },
      };
    }
    if (decidePreferredClawHubFallback(clawhubResult) !== "fallback_to_npm") {
      throw new PluginControlPlaneError("invalid-request", clawhubResult.error);
    }
  }

  const npmResult = await installPluginFromNpmSpec({
    spec: params.raw,
  });
  if (!npmResult.ok) {
    throw new PluginControlPlaneError("invalid-request", npmResult.error);
  }
  clearPluginManifestRegistryCache();
  return {
    pluginId: npmResult.pluginId,
    installSource: "npm",
    installRecord: buildNpmInstallRecordFields({
      spec: params.raw,
      installPath: npmResult.targetDir,
      version: npmResult.version,
      resolution: npmResult.npmResolution,
    }),
  };
}

export async function enablePluginFromControlPlane(params: {
  pluginId: string;
  baseHash?: string;
}): Promise<PluginControlPlaneResult> {
  return await persistPluginConfigMutation({
    baseHash: params.baseHash,
    mutate: (config) => {
      const enabled = enablePluginInConfig(config, params.pluginId);
      if (!enabled.enabled) {
        throw new PluginControlPlaneError(
          "invalid-request",
          `plugin "${params.pluginId}" could not be enabled (${enabled.reason ?? "unknown reason"})`,
        );
      }
      const slotResult = applySlotSelectionForPlugin(enabled.config, params.pluginId);
      return {
        pluginId: params.pluginId,
        nextConfig: slotResult.config,
        warnings: slotResult.warnings,
      };
    },
  });
}

export async function disablePluginFromControlPlane(params: {
  pluginId: string;
  baseHash?: string;
}): Promise<PluginControlPlaneResult> {
  return await persistPluginConfigMutation({
    baseHash: params.baseHash,
    mutate: (config) => ({
      pluginId: params.pluginId,
      nextConfig: setPluginEnabledInConfig(config, params.pluginId, false),
      warnings: [],
    }),
  });
}

export async function installPluginFromControlPlane(params: {
  raw: string;
  baseHash?: string;
}): Promise<PluginControlPlaneResult> {
  await preflightConfigBaseHash(params.baseHash);
  const normalized = normalizeInstallSpec(params.raw);
  const installed = await installPluginArtifact(normalized);
  return await persistPluginConfigMutation({
    baseHash: params.baseHash,
    mutate: (config) => {
      const enabled = enablePluginInConfig(config, installed.pluginId);
      if (!enabled.enabled) {
        throw new PluginControlPlaneError(
          "invalid-request",
          `plugin "${installed.pluginId}" could not be enabled (${enabled.reason ?? "unknown reason"})`,
        );
      }
      const recorded = recordPluginInstall(enabled.config, {
        pluginId: installed.pluginId,
        ...installed.installRecord,
      });
      const slotResult = applySlotSelectionForPlugin(recorded, installed.pluginId);
      return {
        pluginId: installed.pluginId,
        nextConfig: slotResult.config,
        warnings: slotResult.warnings,
        installSource: installed.installSource,
      };
    },
  });
}
