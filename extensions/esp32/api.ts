import type { CrawClawPluginApi } from "crawclaw/plugin-sdk/core";
import type { Esp32PluginConfig } from "./src/config.js";
import type { StoredEsp32Device } from "./src/device-store.js";
import type { Esp32PairingSession } from "./src/pairing.js";
import { getEsp32PluginRuntime, getEsp32Service } from "./src/runtime.js";
import type { Esp32ChannelService, Esp32OnlineDeviceSnapshot } from "./src/service.js";

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
export { ESP32_DEVICE_ROLE, ESP32_HARDWARE_TARGET } from "./src/types.js";
export {
  isEsp32PluginEnabled,
  readEsp32PluginConfigFromCrawClawConfig,
  resolveEsp32PluginConfig,
} from "./src/config.js";
export {
  issueEsp32PairingSession,
  listEsp32PairingSessions,
  revokeEsp32PairingSession,
} from "./src/pairing.js";
export type {
  StoredEsp32Device,
  Esp32PairingSession,
  Esp32ChannelService,
  Esp32OnlineDeviceSnapshot,
  Esp32PluginConfig,
};
export { getEsp32PluginRuntime, getEsp32Service };
