import type { HookEntry } from "../hooks/types.js";
import type { PluginActivationSource } from "./config-state.js";
import { createEmptyPluginRegistry } from "./registry-empty.js";
import type {
  WebFetchProviderPlugin,
  CrawClawPluginCommandDefinition,
  CrawClawPluginHttpRouteAuth,
  CrawClawPluginHttpRouteMatch,
  CrawClawPluginHttpRouteHandler,
  CrawClawPluginService,
  PluginConfigUiHint,
  PluginDiagnostic,
  PluginBundleFormat,
  PluginFormat,
  PluginLogger,
  PluginKind,
  PluginOrigin,
  SpeechProviderPlugin,
  WebSearchProviderPlugin,
} from "./types.js";

export type PluginHttpRouteRegistration = {
  pluginId?: string;
  path: string;
  handler: CrawClawPluginHttpRouteHandler;
  auth: CrawClawPluginHttpRouteAuth;
  match: CrawClawPluginHttpRouteMatch;
  source?: string;
};

type PluginOwnedProviderRegistration<T extends { id: string }> = {
  pluginId: string;
  pluginName?: string;
  provider: T;
  source: string;
  rootDir?: string;
};

export type PluginSpeechProviderRegistration =
  PluginOwnedProviderRegistration<SpeechProviderPlugin>;
export type PluginProviderRegistration = never;
export type PluginWebFetchProviderRegistration =
  PluginOwnedProviderRegistration<WebFetchProviderPlugin>;
export type PluginWebSearchProviderRegistration =
  PluginOwnedProviderRegistration<WebSearchProviderPlugin>;

export type WorkspaceHookRegistration = {
  pluginId: string;
  entry: HookEntry;
  events: string[];
  source: string;
  rootDir?: string;
};

export type PluginServiceRegistration = {
  pluginId: string;
  pluginName?: string;
  service: CrawClawPluginService;
  source: string;
  rootDir?: string;
};

export type PluginCommandRegistration = {
  pluginId: string;
  pluginName?: string;
  command: CrawClawPluginCommandDefinition;
  source: string;
  rootDir?: string;
};

export type PluginRecord = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  format?: PluginFormat;
  bundleFormat?: PluginBundleFormat;
  bundleCapabilities?: string[];
  kind?: PluginKind | PluginKind[];
  source: string;
  rootDir?: string;
  origin: PluginOrigin;
  workspaceDir?: string;
  enabled: boolean;
  explicitlyEnabled?: boolean;
  activated?: boolean;
  imported?: boolean;
  activationSource?: PluginActivationSource;
  activationReason?: string;
  status: "loaded" | "disabled" | "error";
  error?: string;
  toolNames: string[];
  hookNames: string[];
  providerIds: string[];
  speechProviderIds: string[];
  webFetchProviderIds: string[];
  webSearchProviderIds: string[];
  services: string[];
  commands: string[];
  httpRoutes: number;
  hookCount: number;
  configSchema: boolean;
  configUiHints?: Record<string, PluginConfigUiHint>;
  configJsonSchema?: Record<string, unknown>;
  memorySlotSelected?: boolean;
};

export type PluginRegistry = {
  plugins: PluginRecord[];
  hooks: WorkspaceHookRegistration[];
  providers: PluginProviderRegistration[];
  speechProviders: PluginSpeechProviderRegistration[];
  webFetchProviders: PluginWebFetchProviderRegistration[];
  webSearchProviders: PluginWebSearchProviderRegistration[];
  httpRoutes: PluginHttpRouteRegistration[];
  services: PluginServiceRegistration[];
  commands: PluginCommandRegistration[];
  diagnostics: PluginDiagnostic[];
};

export type PluginRegistryParams = {
  logger: PluginLogger;
  // When false, keep registration local to the returned registry and avoid mutating
  // process-global command/hook state during non-activating snapshot loads.
  activateGlobalSideEffects?: boolean;
};

export { createEmptyPluginRegistry } from "./registry-empty.js";

export function createPluginRegistry(_registryParams: PluginRegistryParams) {
  const registry = createEmptyPluginRegistry();

  const pushDiagnostic = (diag: PluginDiagnostic) => {
    registry.diagnostics.push(diag);
  };

  return {
    registry,
    pushDiagnostic,
  };
}
