import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLED_SPEECH_PLUGIN_IDS } from "../bundled-capability-metadata.js";
import { loadBundledCapabilityRuntimeRegistry } from "../bundled-capability-runtime.js";
import { createCrawClawJiti } from "../jiti-loader.js";
import { loadPluginManifestRegistry } from "../manifest-registry.js";
import { buildPluginLoaderAliasMap, buildPluginLoaderJitiOptions } from "../runtime-alias.js";
import type { SpeechProviderPlugin } from "../types.js";

export type SpeechProviderContractEntry = {
  pluginId: string;
  provider: SpeechProviderPlugin;
};

function buildVitestCapabilityAliasMap(): Record<string, string> {
  const scopedAliasMap = buildPluginLoaderAliasMap();
  return {
    ...scopedAliasMap,
    "../../internal-plugin-helpers/llm-task.js": fileURLToPath(
      new URL("../capability-runtime-vitest-shims/llm-task.ts", import.meta.url),
    ),
    "../../internal-plugin-helpers/speech-core.js": fileURLToPath(
      new URL("../capability-runtime-vitest-shims/speech-core.ts", import.meta.url),
    ),
  };
}

function resolveNamedBuilder<T>(moduleExport: unknown, pattern: RegExp): (() => T) | undefined {
  if (!moduleExport || typeof moduleExport !== "object") {
    return undefined;
  }
  for (const [key, value] of Object.entries(moduleExport as Record<string, unknown>)) {
    if (pattern.test(key) && typeof value === "function") {
      return value as () => T;
    }
  }
  return undefined;
}

function resolveTestApiModuleRecords(pluginIds: readonly string[]) {
  const unresolvedPluginIds = new Set(pluginIds);
  const manifests = loadPluginManifestRegistry({}).plugins.filter(
    (plugin) => plugin.origin === "bundled" && unresolvedPluginIds.has(plugin.id),
  );
  return { manifests, unresolvedPluginIds };
}

function createVitestCapabilityLoader() {
  return createCrawClawJiti(import.meta.url, {
    ...buildPluginLoaderJitiOptions(buildVitestCapabilityAliasMap()),
    tryNative: false,
  });
}

export function loadVitestSpeechProviderContractRegistry(): SpeechProviderContractEntry[] {
  const registrations: SpeechProviderContractEntry[] = [];
  const { manifests, unresolvedPluginIds } = resolveTestApiModuleRecords(BUNDLED_SPEECH_PLUGIN_IDS);

  for (const plugin of manifests) {
    if (!plugin.rootDir) {
      continue;
    }
    const testApiPath = path.join(plugin.rootDir, "test-api.ts");
    if (!fs.existsSync(testApiPath)) {
      continue;
    }
    const builder = resolveNamedBuilder<SpeechProviderPlugin>(
      createVitestCapabilityLoader()(testApiPath),
      /^build.+SpeechProvider$/u,
    );
    if (!builder) {
      continue;
    }
    registrations.push({
      pluginId: plugin.id,
      provider: builder(),
    });
    unresolvedPluginIds.delete(plugin.id);
  }

  if (unresolvedPluginIds.size === 0) {
    return registrations;
  }

  const runtimeRegistry = loadBundledCapabilityRuntimeRegistry({
    pluginIds: [...unresolvedPluginIds],
    runtimeResolution: "dist",
  });
  registrations.push(
    ...runtimeRegistry.speechProviders.map((entry) => ({
      pluginId: entry.pluginId,
      provider: entry.provider,
    })),
  );
  return registrations;
}
