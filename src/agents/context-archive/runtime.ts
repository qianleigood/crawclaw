import { loadConfig, type CrawClawConfig } from "../../config/config.js";
import { resolveMemoryConfig } from "../../memory/config/resolve.js";
import { SqliteRuntimeStore } from "../../memory/runtime/sqlite-runtime-store.js";
import { createContextArchiveService, type ContextArchiveService } from "./service.js";

type SharedContextArchiveCache = {
  cacheKey: string;
  servicePromise: Promise<ContextArchiveService | undefined>;
};

let sharedContextArchiveCache: SharedContextArchiveCache | null = null;

function resolveEffectiveConfig(config?: CrawClawConfig): CrawClawConfig | undefined {
  if (config) {
    return config;
  }
  try {
    return loadConfig();
  } catch {
    return undefined;
  }
}

function resolveRawMemoryConfig(config?: CrawClawConfig): unknown {
  const effectiveConfig = resolveEffectiveConfig(config);
  const contextArchive = effectiveConfig?.memory?.contextArchive;
  if (!contextArchive) {
    return undefined;
  }
  return { contextArchive };
}

export async function resolveSharedContextArchiveService(
  config?: CrawClawConfig,
): Promise<ContextArchiveService | undefined> {
  const rawConfig = resolveRawMemoryConfig(config);
  if (!rawConfig) {
    return undefined;
  }
  const resolved = resolveMemoryConfig(rawConfig);
  const archiveMode = resolved.contextArchive?.mode ?? "off";
  if (archiveMode === "off") {
    return undefined;
  }
  const cacheKey = [
    resolved.runtimeStore.dbPath,
    resolved.contextArchive?.rootDir ?? "",
    archiveMode,
    String(resolved.contextArchive?.retentionDays ?? ""),
    String(resolved.contextArchive?.maxBlobBytes ?? ""),
    String(resolved.contextArchive?.maxTotalBytes ?? ""),
  ].join("::");
  if (sharedContextArchiveCache?.cacheKey === cacheKey) {
    return await sharedContextArchiveCache.servicePromise;
  }
  const servicePromise = (async () => {
    const runtimeStore = new SqliteRuntimeStore(resolved.runtimeStore.dbPath);
    await runtimeStore.init();
    return createContextArchiveService({
      runtimeStore,
      rootDir: resolved.contextArchive?.rootDir,
      defaultArchiveMode: archiveMode,
      retentionDays: resolved.contextArchive?.retentionDays ?? null,
      maxBlobBytes: resolved.contextArchive?.maxBlobBytes ?? null,
      maxTotalBytes: resolved.contextArchive?.maxTotalBytes ?? null,
    });
  })();
  sharedContextArchiveCache = { cacheKey, servicePromise };
  return await servicePromise;
}

export function resetSharedContextArchiveServiceForTests(): void {
  sharedContextArchiveCache = null;
}
