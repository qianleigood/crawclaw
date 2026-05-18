import type { PluginRegistry } from "./registry.js";

export function createEmptyPluginRegistry(): PluginRegistry {
  return {
    plugins: [],
    hooks: [],
    webFetchProviders: [],
    webSearchProviders: [],
    commands: [],
    diagnostics: [],
  };
}
