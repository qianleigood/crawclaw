// Private runtime barrel for the bundled Feishu extension.
// Keep this barrel thin and aligned with the local extension surface.

export type {
  ChannelMessageActionName,
  ChannelMeta,
  ChannelOutboundAdapter,
  CrawClawConfig as ClawdbotConfig,
  CrawClawConfig,
  CrawClawPluginApi,
  PluginRuntime,
  RuntimeEnv,
} from "crawclaw/plugin-sdk/feishu";
export {
  DEFAULT_ACCOUNT_ID,
  PAIRING_APPROVED_MESSAGE,
  buildChannelConfigSchema,
  buildProbeChannelStatusSummary,
  createActionGate,
  createDefaultChannelRuntimeState,
} from "crawclaw/plugin-sdk/feishu";
export * from "crawclaw/plugin-sdk/feishu";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "crawclaw/plugin-sdk/webhook-ingress";
