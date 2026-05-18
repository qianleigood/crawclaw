import {
  withBundledPluginEnablementCompat,
  withBundledPluginVitestCompat,
} from "./bundled-compat.js";
import { discoverCrawClawPlugins } from "./discovery.js";
import type { PluginLoadOptions } from "./loader.js";
import { loadPluginManifestRegistry } from "./manifest-registry.js";
import { createEmptyPluginRegistry } from "./registry-empty.js";
import type { PluginRecord } from "./registry.js";
import { isApiKeylessBundledWebSearchPluginId } from "./web-search-provider-policy.js";

export function buildBundledCapabilityRuntimeConfig(
  pluginIds: readonly string[],
  env?: PluginLoadOptions["env"],
): PluginLoadOptions["config"] {
  const enablementCompat = withBundledPluginEnablementCompat({
    config: undefined,
    pluginIds,
  });
  return withBundledPluginVitestCompat({
    config: enablementCompat,
    pluginIds,
    env,
  });
}

function createCapabilityPluginRecord(params: {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  source: string;
  rootDir?: string;
  workspaceDir?: string;
}): PluginRecord {
  return {
    id: params.id,
    name: params.name ?? params.id,
    version: params.version,
    description: params.description,
    source: params.source,
    rootDir: params.rootDir,
    origin: "bundled",
    workspaceDir: params.workspaceDir,
    enabled: true,
    status: "loaded",
    toolNames: [],
    hookNames: [],
    providerIds: [],
    speechProviderIds: [],
    webFetchProviderIds: [],
    webSearchProviderIds: [],
    services: [],
    commands: [],
    httpRoutes: 0,
    hookCount: 0,
    configSchema: true,
  };
}

function pushUnique(target: string[], values: readonly string[] | undefined): void {
  for (const value of values ?? []) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

export function loadBundledCapabilityRuntimeRegistry(params: {
  pluginIds: readonly string[];
  env?: PluginLoadOptions["env"];
}) {
  const env = params.env ?? process.env;
  const pluginIds = new Set(params.pluginIds);
  const registry = createEmptyPluginRegistry();

  const discovery = discoverCrawClawPlugins({
    cache: false,
    env,
  });
  const manifestRegistry = loadPluginManifestRegistry({
    config: buildBundledCapabilityRuntimeConfig(params.pluginIds, env),
    cache: false,
    env,
    candidates: discovery.candidates,
    diagnostics: discovery.diagnostics,
  });
  registry.diagnostics.push(...manifestRegistry.diagnostics);

  const manifestByRoot = new Map(
    manifestRegistry.plugins.map((record) => [record.rootDir, record]),
  );
  const seenPluginIds = new Set<string>();

  for (const candidate of discovery.candidates) {
    const manifest = manifestByRoot.get(candidate.rootDir);
    if (!manifest || manifest.origin !== "bundled" || !pluginIds.has(manifest.id)) {
      continue;
    }
    if (seenPluginIds.has(manifest.id)) {
      continue;
    }
    seenPluginIds.add(manifest.id);

    const record = createCapabilityPluginRecord({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      source: candidate.source,
      rootDir: candidate.rootDir,
      workspaceDir: candidate.workspaceDir,
    });

    if (manifest.native || manifest.format === "native") {
      pushUnique(record.providerIds, manifest.providers);
      pushUnique(record.speechProviderIds, manifest.contracts?.speechProviders);
      pushUnique(record.webFetchProviderIds, manifest.contracts?.webFetchProviders);
      pushUnique(
        record.webSearchProviderIds,
        isApiKeylessBundledWebSearchPluginId(record.id)
          ? manifest.contracts?.webSearchProviders
          : undefined,
      );
      pushUnique(record.toolNames, manifest.contracts?.tools);
      registry.plugins.push(record);
      continue;
    }

    registry.plugins.push(record);
  }

  return registry;
}
