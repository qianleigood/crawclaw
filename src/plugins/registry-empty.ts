import type { PluginRegistry } from "./registry.js";

export function createEmptyPluginRegistry(): PluginRegistry {
  return {
    plugins: [],
    tools: [],
    hooks: [],
    providers: [],
    speechProviders: [],
    webFetchProviders: [],
    webSearchProviders: [],
    gatewayHandlers: {},
    gatewayMethodScopes: {},
    httpRoutes: [],
    services: [],
    commands: [],
    diagnostics: [],
  };
}
