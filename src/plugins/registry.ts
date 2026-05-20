import type { HookEntry } from "../hooks/types.js";
import { createEmptyPluginRegistry } from "./registry-empty.js";
import type {
  WebFetchProviderPlugin,
  CrawClawPluginCommandDefinition,
  PluginConfigUiHint,
  PluginDiagnostic,
  PluginBundleFormat,
  PluginFormat,
  PluginLogger,
  PluginKind,
  PluginOrigin,
  PluginActivationSource,
  WebSearchProviderPlugin,
} from "./types.js";

type PluginOwnedProviderRegistration<T extends { id: string }> = {
  pluginId: string;
  pluginName?: string;
  provider: T;
  source: string;
  rootDir?: string;
};

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
  webFetchProviderIds: string[];
  webSearchProviderIds: string[];
  services: string[];
  commands: string[];
  hookCount: number;
  configSchema: boolean;
  configUiHints?: Record<string, PluginConfigUiHint>;
  configJsonSchema?: Record<string, unknown>;
  memorySlotSelected?: boolean;
};

export type PluginRegistry = {
  plugins: PluginRecord[];
  hooks: WorkspaceHookRegistration[];
  webFetchProviders: PluginWebFetchProviderRegistration[];
  webSearchProviders: PluginWebSearchProviderRegistration[];
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
