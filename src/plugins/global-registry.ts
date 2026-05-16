import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { PluginRegistry } from "./registry.js";

type PluginRegistryGlobalState = {
  registry: PluginRegistry | null;
};

const pluginRegistryGlobalStateKey = Symbol.for("crawclaw.plugins.global-registry-state");
const getState = () =>
  resolveGlobalSingleton<PluginRegistryGlobalState>(pluginRegistryGlobalStateKey, () => ({
    registry: null,
  }));

export function initializeGlobalPluginRegistry(registry: PluginRegistry): void {
  getState().registry = registry;
}

export function getGlobalPluginRegistry(): PluginRegistry | null {
  return getState().registry;
}

export function resetGlobalPluginRegistry(): void {
  getState().registry = null;
}
