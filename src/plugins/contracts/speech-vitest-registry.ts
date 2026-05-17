import { BUNDLED_SPEECH_PLUGIN_IDS } from "../bundled-capability-metadata.js";
import { loadBundledCapabilityRuntimeRegistry } from "../bundled-capability-runtime.js";
import type { SpeechProviderPlugin } from "../types.js";

export type SpeechProviderContractEntry = {
  pluginId: string;
  provider: SpeechProviderPlugin;
};

export function loadVitestSpeechProviderContractRegistry(): SpeechProviderContractEntry[] {
  const runtimeRegistry = loadBundledCapabilityRuntimeRegistry({
    pluginIds: BUNDLED_SPEECH_PLUGIN_IDS,
    runtimeResolution: "dist",
  });
  return runtimeRegistry.speechProviders.map((entry) => ({
    pluginId: entry.pluginId,
    provider: entry.provider,
  }));
}
