import type { CrawClawPluginApi } from "crawclaw/plugin-sdk/core";

export type CrawClawPluginCliRegistrar = Parameters<CrawClawPluginApi["registerCli"]>[0];

export {
  createChannelPluginBase,
  defineChannelPluginEntry,
  type ChannelConfigUiHint,
  type ChannelPlugin,
  type CrawClawConfig,
  type CrawClawPluginApi,
  type CrawClawPluginConfigSchema,
  type CrawClawPluginService,
  type CrawClawPluginServiceContext,
  type CrawClawPluginToolFactory,
  type PluginLogger,
  type PluginRuntime,
} from "crawclaw/plugin-sdk/core";
export {
  ensureDeviceToken,
  getPairedDevice,
  requestDevicePairing,
  verifyDeviceToken,
  type PairedDevice,
} from "crawclaw/plugin-sdk/infra-runtime";
export { runFfmpeg } from "crawclaw/plugin-sdk/media-runtime";
export { synthesizeSpeech } from "crawclaw/plugin-sdk/speech-runtime";
