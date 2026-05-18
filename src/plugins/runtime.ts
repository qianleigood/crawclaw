import { createEmptyPluginRegistry } from "./registry-empty.js";
import type { PluginRegistry } from "./registry.js";

const REGISTRY_STATE = Symbol.for("crawclaw.pluginRegistryState");

type RegistryState = {
  activeRegistry: PluginRegistry | null;
  activeVersion: number;
  key: string | null;
};

const state: RegistryState = (() => {
  const globalState = globalThis as typeof globalThis & {
    [REGISTRY_STATE]?: RegistryState;
  };
  if (!globalState[REGISTRY_STATE]) {
    globalState[REGISTRY_STATE] = {
      activeRegistry: null,
      activeVersion: 0,
      key: null,
    };
  }
  return globalState[REGISTRY_STATE];
})();

export function setActivePluginRegistry(registry: PluginRegistry, cacheKey?: string) {
  state.activeRegistry = registry;
  state.activeVersion += 1;
  state.key = cacheKey ?? null;
}

export function getActivePluginRegistry(): PluginRegistry | null {
  return state.activeRegistry;
}

export function requireActivePluginRegistry(): PluginRegistry {
  if (!state.activeRegistry) {
    state.activeRegistry = createEmptyPluginRegistry();
    state.activeVersion += 1;
  }
  return state.activeRegistry;
}

export function getActivePluginRegistryKey(): string | null {
  return state.key;
}

export function getActivePluginRegistryVersion(): number {
  return state.activeVersion;
}

export function resetPluginRuntimeStateForTest(): void {
  state.activeRegistry = null;
  state.activeVersion += 1;
  state.key = null;
}
