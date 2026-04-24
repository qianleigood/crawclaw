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
  PluginInteractiveTelegramHandlerContext,
  PluginLogger,
  ProviderAugmentModelCatalogContext,
  ProviderAuthContext,
  ProviderAuthDoctorHintContext,
  ProviderAuthMethod,
  ProviderAuthMethodNonInteractiveContext,
  ProviderAuthResult,
  ProviderBuildMissingAuthMessageContext,
  ProviderBuildUnknownModelHintContext,
  ProviderBuiltInModelSuppressionContext,
  ProviderBuiltInModelSuppressionResult,
  ProviderCacheTtlEligibilityContext,
  ProviderCatalogContext,
  ProviderCatalogResult,
  ProviderDefaultThinkingPolicyContext,
  ProviderFetchUsageSnapshotContext,
  ProviderModernModelPolicyContext,
  ProviderNormalizeConfigContext,
  ProviderNormalizeToolSchemasContext,
  ProviderNormalizeTransportContext,
  ProviderResolveConfigApiKeyContext,
  ProviderNormalizeModelIdContext,
  ProviderNormalizeResolvedModelContext,
  ProviderPrepareDynamicModelContext,
  ProviderPrepareExtraParamsContext,
  ProviderPrepareRuntimeAuthContext,
  ProviderPreparedRuntimeAuth,
  ProviderReasoningOutputMode,
  ProviderReasoningOutputModeContext,
  ProviderReplayPolicy,
  ProviderReplayPolicyContext,
  ProviderResolvedUsageAuth,
  ProviderResolveDynamicModelContext,
  ProviderSanitizeReplayHistoryContext,
  ProviderResolveUsageAuthContext,
  ProviderRuntimeModel,
  ProviderThinkingPolicyContext,
  ProviderValidateReplayTurnsContext,
  ProviderWrapStreamFnContext,
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
  ProviderCatalogContext,
  ProviderCatalogResult,
  ProviderAugmentModelCatalogContext,
  ProviderBuiltInModelSuppressionContext,
  ProviderBuiltInModelSuppressionResult,
  ProviderBuildMissingAuthMessageContext,
  ProviderBuildUnknownModelHintContext,
  ProviderCacheTtlEligibilityContext,
  ProviderDefaultThinkingPolicyContext,
  ProviderFetchUsageSnapshotContext,
  ProviderModernModelPolicyContext,
  ProviderNormalizeConfigContext,
  ProviderNormalizeToolSchemasContext,
  ProviderNormalizeTransportContext,
  ProviderResolveConfigApiKeyContext,
  ProviderNormalizeModelIdContext,
  ProviderReplayPolicy,
  ProviderReplayPolicyContext,
  ProviderPreparedRuntimeAuth,
  ProviderReasoningOutputMode,
  ProviderReasoningOutputModeContext,
  ProviderResolvedUsageAuth,
  ProviderPrepareExtraParamsContext,
  ProviderPrepareDynamicModelContext,
  ProviderPrepareRuntimeAuthContext,
  ProviderSanitizeReplayHistoryContext,
  ProviderResolveUsageAuthContext,
  ProviderResolveDynamicModelContext,
  ProviderNormalizeResolvedModelContext,
  ProviderRuntimeModel,
  SpeechProviderPlugin,
  ProviderThinkingPolicyContext,
  ProviderValidateReplayTurnsContext,
  ProviderWrapStreamFnContext,
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
  PluginInteractiveTelegramHandlerContext,
};
export type { CrawClawConfig } from "../config/config.js";

export { emptyPluginConfigSchema } from "../plugins/config-schema.js";

/** Options for a plugin entry that registers providers, tools, commands, or services. */
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
 * Canonical entry helper for non-channel plugins.
 *
 * Use this for provider, tool, command, service, and memory plugins.
 * Channel plugins should use `defineChannelPluginEntry(...)` from
 * `crawclaw/plugin-sdk/core` so they inherit the channel capability wiring.
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
