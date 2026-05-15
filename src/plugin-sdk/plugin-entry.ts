import type { CrawClawConfig } from "../config/config.js";
import { emptyPluginConfigSchema } from "../plugins/config-schema.js";
import { PLUGIN_ENTRY_TYPE_FIELD } from "../plugins/entry-contract.js";
import type {
  AnyAgentTool,
  MediaUnderstandingProviderPlugin,
  CrawClawPluginApi,
  CrawClawPluginCommandDefinition,
  CrawClawPluginConfigSchema,
  CrawClawPluginDefinition,
  CrawClawPluginService,
  CrawClawPluginServiceContext,
  CrawClawPluginToolContext,
  CrawClawPluginToolFactory,
  PluginLogger,
  ProviderAuthContext,
  ProviderAuthDoctorHintContext,
  ProviderAuthMethod,
  ProviderAuthMethodNonInteractiveContext,
  ProviderAuthResult,
  SpeechProviderPlugin,
  PluginCommandContext,
} from "../plugins/types.js";

export type {
  AnyAgentTool,
  MediaUnderstandingProviderPlugin,
  CrawClawPluginApi,
  CrawClawPluginToolContext,
  CrawClawPluginToolFactory,
  PluginCommandContext,
  CrawClawPluginConfigSchema,
  SpeechProviderPlugin,
  CrawClawPluginService,
  CrawClawPluginServiceContext,
  ProviderAuthContext,
  ProviderAuthDoctorHintContext,
  ProviderAuthMethodNonInteractiveContext,
  ProviderAuthMethod,
  ProviderAuthResult,
  CrawClawPluginCommandDefinition,
  CrawClawPluginDefinition,
  PluginLogger,
};
export type { CrawClawConfig } from "../config/config.js";

export { emptyPluginConfigSchema } from "../plugins/config-schema.js";

/** Options for a plugin entry that registers tools, commands, services, or non-LLM capabilities. */
type DefinePluginEntryOptions = {
  id: string;
  name: string;
  description: string;
  kind?: CrawClawPluginDefinition["kind"];
  configSchema?: CrawClawPluginConfigSchema | (() => CrawClawPluginConfigSchema);
  register: (api: CrawClawPluginApi) => void;
};

/** Normalized object shape that CrawClaw loads from a plugin entry module. */
type DefinedPluginEntry = {
  [PLUGIN_ENTRY_TYPE_FIELD]: "plugin";
  id: string;
  name: string;
  description: string;
  configSchema: CrawClawPluginConfigSchema;
  register: NonNullable<CrawClawPluginDefinition["register"]>;
} & Pick<CrawClawPluginDefinition, "kind">;

/** Resolve either a concrete config schema or a lazy schema factory. */
function resolvePluginConfigSchema(
  configSchema: DefinePluginEntryOptions["configSchema"] = emptyPluginConfigSchema,
): CrawClawPluginConfigSchema {
  return typeof configSchema === "function" ? configSchema() : configSchema;
}

/**
 * Canonical entry helper for plugins that are not channel adapters.
 *
 * Use this for tool, command, service, memory, speech, media, web fetch, and web search plugins.
 * TypeScript channel plugins are no longer a production contract; channels are
 * implemented as Rust-native adapters.
 */
export function definePluginEntry({
  id,
  name,
  description,
  kind,
  configSchema = emptyPluginConfigSchema,
  register,
}: DefinePluginEntryOptions): DefinedPluginEntry {
  return {
    [PLUGIN_ENTRY_TYPE_FIELD]: "plugin",
    id,
    name,
    description,
    ...(kind ? { kind } : {}),
    configSchema: resolvePluginConfigSchema(configSchema),
    register,
  };
}

export type { CrawClawToolSchema } from "../plugins/types.js";
