import type { PluginRegistry } from "./registry.js";

const REGISTRY_STATE = Symbol.for("crawclaw.pluginRegistryState");

type RegistryState = {
  activeRegistry: PluginRegistry | null;
};

const state: RegistryState = (() => {
  const globalState = globalThis as typeof globalThis & {
    [REGISTRY_STATE]?: RegistryState;
  };
  if (!globalState[REGISTRY_STATE]) {
    globalState[REGISTRY_STATE] = {
      activeRegistry: null,
    };
  }
  return globalState[REGISTRY_STATE];
})();

export function setActivePluginRegistry(registry: PluginRegistry): void {
  state.activeRegistry = registry;
}

export function getActivePluginRegistry(): PluginRegistry | null {
  return state.activeRegistry;
}

export function resetPluginRuntimeStateForTest(): void {
  state.activeRegistry = null;
}
