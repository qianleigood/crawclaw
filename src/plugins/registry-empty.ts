import type { PluginRegistry } from "./registry.js";

export function createEmptyPluginRegistry(): PluginRegistry {
  return {
    plugins: [],
    hooks: [],
    providers: [],
    speechProviders: [],
    webFetchProviders: [],
    webSearchProviders: [],
    httpRoutes: [],
    services: [],
    commands: [],
    diagnostics: [],
  };
}
