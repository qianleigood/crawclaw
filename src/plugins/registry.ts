import type { OperatorScope } from "../gateway/method-scopes.js";
import type { GatewayRequestHandlers } from "../gateway/request-types.js";
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
  CrawClawPluginToolFactory,
  PluginConfigUiHint,
  PluginDiagnostic,
  PluginBundleFormat,
  PluginFormat,
  PluginLogger,
  PluginOrigin,
  PluginKind,
  SpeechProviderPlugin,
  WebSearchProviderPlugin,
} from "./types.js";

export type PluginToolRegistration = {
  pluginId: string;
  pluginName?: string;
  factory: CrawClawPluginToolFactory;
  names: string[];
  optional: boolean;
  source: string;
  rootDir?: string;
};

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
  gatewayMethods: string[];
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
  tools: PluginToolRegistration[];
  hooks: WorkspaceHookRegistration[];
  providers: PluginProviderRegistration[];
  speechProviders: PluginSpeechProviderRegistration[];
  webFetchProviders: PluginWebFetchProviderRegistration[];
  webSearchProviders: PluginWebSearchProviderRegistration[];
  gatewayHandlers: GatewayRequestHandlers;
  gatewayMethodScopes?: Partial<Record<string, OperatorScope>>;
  httpRoutes: PluginHttpRouteRegistration[];
  services: PluginServiceRegistration[];
  commands: PluginCommandRegistration[];
  diagnostics: PluginDiagnostic[];
};

export type PluginRegistryParams = {
  logger: PluginLogger;
  coreGatewayHandlers?: GatewayRequestHandlers;
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
