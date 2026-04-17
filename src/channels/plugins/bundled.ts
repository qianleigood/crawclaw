import fs from "node:fs";
import { createJiti } from "jiti";
import { openBoundaryFileSync } from "../../infra/boundary-file-read.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { discoverCrawClawPlugins } from "../../plugins/discovery.js";
import {
  resolveChannelPluginModuleEntry,
  resolveSetupChannelRegistration,
} from "../../plugins/entry-contract.js";
import { loadPluginManifestRegistry } from "../../plugins/manifest-registry.js";
import type { PluginRuntime } from "../../plugins/runtime/types.js";
import {
  buildPluginLoaderAliasMap,
  buildPluginLoaderJitiOptions,
  shouldPreferNativeJiti,
} from "../../plugins/sdk-alias.js";
import type { ChannelId, ChannelPlugin } from "./types.js";

type GeneratedBundledChannelEntry = {
  id: string;
  entry: {
    channelPlugin: ChannelPlugin;
    setChannelRuntime?: (runtime: PluginRuntime) => void;
  };
  setupEntry?: {
    plugin: ChannelPlugin;
  };
};

const log = createSubsystemLogger("channels");

function createModuleLoader() {
  const jitiLoaders = new Map<string, ReturnType<typeof createJiti>>();

  return (modulePath: string) => {
    const tryNative = shouldPreferNativeJiti(modulePath);
    const aliasMap = buildPluginLoaderAliasMap(modulePath, process.argv[1], import.meta.url);
    const cacheKey = JSON.stringify({
      tryNative,
      aliasMap: Object.entries(aliasMap).toSorted(([left], [right]) => left.localeCompare(right)),
    });
    const cached = jitiLoaders.get(cacheKey);
    if (cached) {
      return cached;
    }
    const loader = createJiti(import.meta.url, {
      ...buildPluginLoaderJitiOptions(aliasMap),
      tryNative,
    });
    jitiLoaders.set(cacheKey, loader);
    return loader;
  };
}

const loadModule = createModuleLoader();

function loadBundledModule(modulePath: string, rootDir: string): unknown {
  const opened = openBoundaryFileSync({
    absolutePath: modulePath,
    rootPath: rootDir,
    boundaryLabel: "plugin root",
    rejectHardlinks: false,
    skipLexicalRootCheck: true,
  });
  if (!opened.ok) {
    throw new Error("plugin entry path escapes plugin root or fails alias checks");
  }
  const safePath = opened.path;
  fs.closeSync(opened.fd);
  return loadModule(safePath)(safePath);
}

function loadGeneratedBundledChannelEntries(): readonly GeneratedBundledChannelEntry[] {
  const discovery = discoverCrawClawPlugins({ cache: false });
  const manifestRegistry = loadPluginManifestRegistry({
    cache: false,
    config: {},
    candidates: discovery.candidates,
    diagnostics: discovery.diagnostics,
  });
  const manifestByRoot = new Map(
    manifestRegistry.plugins.map((plugin) => [plugin.rootDir, plugin] as const),
  );
  const seenIds = new Set<string>();
  const entries: GeneratedBundledChannelEntry[] = [];

  for (const candidate of discovery.candidates) {
    const manifest = manifestByRoot.get(candidate.rootDir);
    if (!manifest || manifest.origin !== "bundled" || manifest.channels.length === 0) {
      continue;
    }
    if (seenIds.has(manifest.id)) {
      continue;
    }
    seenIds.add(manifest.id);

    try {
      const entry = resolveChannelPluginModuleEntry(
        loadBundledModule(candidate.source, candidate.rootDir),
      );
      if (!entry.channelPlugin) {
        log.warn(
          `[channels] bundled channel entry ${manifest.id} missing channelPlugin export; skipping`,
        );
        continue;
      }
      const normalizedEntry: GeneratedBundledChannelEntry["entry"] = {
        channelPlugin: entry.channelPlugin,
        ...(entry.setChannelRuntime ? { setChannelRuntime: entry.setChannelRuntime } : {}),
      };
      const setupRegistration = manifest.setupSource
        ? resolveSetupChannelRegistration(
            loadBundledModule(manifest.setupSource, candidate.rootDir),
          )
        : {};
      const setupEntry = setupRegistration.plugin ? { plugin: setupRegistration.plugin } : null;
      entries.push({
        id: manifest.id,
        entry: normalizedEntry,
        ...(setupEntry ? { setupEntry } : {}),
      });
    } catch (error) {
      log.warn(
        `[channels] failed to load bundled channel ${manifest.id} from ${candidate.source}: ${String(error)}`,
      );
    }
  }

  return entries;
}

function buildBundledChannelPluginsById(plugins: readonly ChannelPlugin[]) {
  const byId = new Map<ChannelId, ChannelPlugin>();
  for (const plugin of plugins) {
    if (byId.has(plugin.id)) {
      throw new Error(`duplicate bundled channel plugin id: ${plugin.id}`);
    }
    byId.set(plugin.id, plugin);
  }
  return byId;
}

type BundledChannelState = {
  entries: readonly GeneratedBundledChannelEntry[];
  plugins: readonly ChannelPlugin[];
  setupPlugins: readonly ChannelPlugin[];
  pluginsById: Map<ChannelId, ChannelPlugin>;
  runtimeSettersById: Map<
    ChannelId,
    NonNullable<GeneratedBundledChannelEntry["entry"]["setChannelRuntime"]>
  >;
};

let cachedBundledChannelState: BundledChannelState | null = null;

function getBundledChannelState(): BundledChannelState {
  if (cachedBundledChannelState) {
    return cachedBundledChannelState;
  }

  const entries = loadGeneratedBundledChannelEntries();
  const plugins = entries.map(({ entry }) => entry.channelPlugin);
  const setupPlugins = entries.flatMap(({ setupEntry }) => {
    const plugin = setupEntry?.plugin;
    return plugin ? [plugin] : [];
  });
  const runtimeSettersById = new Map<
    ChannelId,
    NonNullable<GeneratedBundledChannelEntry["entry"]["setChannelRuntime"]>
  >();
  for (const { entry } of entries) {
    if (entry.setChannelRuntime) {
      runtimeSettersById.set(entry.channelPlugin.id, entry.setChannelRuntime);
    }
  }

  cachedBundledChannelState = {
    entries,
    plugins,
    setupPlugins,
    pluginsById: buildBundledChannelPluginsById(plugins),
    runtimeSettersById,
  };
  return cachedBundledChannelState;
}

export function listBundledChannelPlugins(): readonly ChannelPlugin[] {
  return getBundledChannelState().plugins;
}

export function listBundledChannelSetupPlugins(): readonly ChannelPlugin[] {
  return getBundledChannelState().setupPlugins;
}

export function getBundledChannelPlugin(id: ChannelId): ChannelPlugin | undefined {
  return getBundledChannelState().pluginsById.get(id);
}

export function requireBundledChannelPlugin(id: ChannelId): ChannelPlugin {
  const plugin = getBundledChannelPlugin(id);
  if (!plugin) {
    throw new Error(`missing bundled channel plugin: ${id}`);
  }
  return plugin;
}

export function setBundledChannelRuntime(id: ChannelId, runtime: PluginRuntime): void {
  const setter = getBundledChannelState().runtimeSettersById.get(id);
  if (!setter) {
    throw new Error(`missing bundled channel runtime setter: ${id}`);
  }
  setter(runtime);
}
