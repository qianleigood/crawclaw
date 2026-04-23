import path from "node:path";
import type { CrawClawConfig } from "../../config/config.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { loadBundledPluginPublicSurfaceModuleSync } from "../../plugin-sdk/facade-runtime.js";
import {
  loadPluginManifestRegistry,
  type PluginManifestRecord,
} from "../../plugins/manifest-registry.js";
import type { PluginPackageStateProbe } from "../../plugins/manifest.js";

type ChannelPackageStateChecker = (params: {
  cfg: CrawClawConfig;
  env?: NodeJS.ProcessEnv;
}) => boolean;

export type ChannelPackageStateMetadataKey = "configuredState" | "persistedAuthState";

type ChannelPackageStateRegistry = {
  records: PluginManifestRecord[];
  recordsByChannelId: Map<string, PluginManifestRecord>;
  checkerCache: Map<string, ChannelPackageStateChecker | null>;
};

const log = createSubsystemLogger("channels");
const registryCache = new Map<ChannelPackageStateMetadataKey, ChannelPackageStateRegistry>();

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolvePackageStateProbe(
  record: PluginManifestRecord,
  metadataKey: ChannelPackageStateMetadataKey,
): PluginPackageStateProbe | null {
  const metadata = record.channelStateProbes?.[metadataKey];
  const specifier = normalizeOptionalString(metadata?.specifier);
  const exportName = normalizeOptionalString(metadata?.exportName);
  if (!specifier || !exportName) {
    return null;
  }
  return { specifier, exportName };
}

function getChannelPackageStateRegistry(
  metadataKey: ChannelPackageStateMetadataKey,
): ChannelPackageStateRegistry {
  const cached = registryCache.get(metadataKey);
  if (cached) {
    return cached;
  }
  const records = loadPluginManifestRegistry({ cache: true }).plugins.filter(
    (record) =>
      record.origin === "bundled" && Boolean(resolvePackageStateProbe(record, metadataKey)),
  );
  const registry = {
    records,
    recordsByChannelId: new Map(
      records
        .map((record) => {
          const channelId = record.channelCatalogMeta?.id?.trim();
          return channelId ? ([channelId, record] as const) : null;
        })
        .filter((entry): entry is readonly [string, PluginManifestRecord] => Boolean(entry)),
    ),
    checkerCache: new Map(),
  } satisfies ChannelPackageStateRegistry;
  registryCache.set(metadataKey, registry);
  return registry;
}

function resolveArtifactBasename(specifier: string): string {
  const normalized = specifier.trim().replace(/^\.\//, "");
  const basename = path.basename(normalized);
  return basename.endsWith(".js") ? basename : `${basename}.js`;
}

function resolveChannelPackageStateChecker(params: {
  record: PluginManifestRecord;
  metadataKey: ChannelPackageStateMetadataKey;
}): ChannelPackageStateChecker | null {
  const registry = getChannelPackageStateRegistry(params.metadataKey);
  const cached = registry.checkerCache.get(params.record.id);
  if (cached !== undefined) {
    return cached;
  }

  const metadata = resolvePackageStateProbe(params.record, params.metadataKey);
  if (!metadata?.specifier || !metadata.exportName) {
    registry.checkerCache.set(params.record.id, null);
    return null;
  }

  try {
    const loaded = loadBundledPluginPublicSurfaceModuleSync<Record<string, unknown>>({
      dirName: path.basename(params.record.rootDir),
      artifactBasename: resolveArtifactBasename(metadata.specifier),
    });
    const checker = loaded[metadata.exportName] as ChannelPackageStateChecker | undefined;
    if (typeof checker !== "function") {
      throw new Error(`missing ${params.metadataKey} export ${metadata.exportName}`);
    }
    registry.checkerCache.set(params.record.id, checker);
    return checker;
  } catch (error) {
    log.warn(
      `[channels] failed to load ${params.metadataKey} checker for ${params.record.id}: ${formatErrorMessage(error)}`,
    );
    registry.checkerCache.set(params.record.id, null);
    return null;
  }
}

export function listBundledChannelIdsForPackageState(
  metadataKey: ChannelPackageStateMetadataKey,
): string[] {
  return getChannelPackageStateRegistry(metadataKey).records.flatMap((record) => {
    const channelId = record.channelCatalogMeta?.id?.trim();
    return channelId ? [channelId] : [];
  });
}

export function hasBundledChannelPackageState(params: {
  metadataKey: ChannelPackageStateMetadataKey;
  channelId: string;
  cfg: CrawClawConfig;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const registry = getChannelPackageStateRegistry(params.metadataKey);
  const record = registry.recordsByChannelId.get(params.channelId);
  if (!record) {
    return false;
  }
  const checker = resolveChannelPackageStateChecker({
    record,
    metadataKey: params.metadataKey,
  });
  return checker ? checker({ cfg: params.cfg, env: params.env }) : false;
}

export const __testing = {
  clearPackageStateProbeCache: () => registryCache.clear(),
};
