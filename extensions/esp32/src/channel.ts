import type { ChannelPlugin, CrawClawConfig } from "../api.js";
import { isEsp32PluginEnabled, readEsp32PluginConfigFromCrawClawConfig } from "./config.js";
import { getEsp32Service } from "./runtime.js";
import { ESP32_CHANNEL_ID, ESP32_HARDWARE_TARGET } from "./types.js";

type Esp32ResolvedAccount = {
  accountId: "default";
  enabled: boolean;
};

function resolveAccount(cfg: CrawClawConfig): Esp32ResolvedAccount {
  return { accountId: "default", enabled: isEsp32PluginEnabled(cfg) };
}

export const esp32ChannelPlugin: ChannelPlugin<Esp32ResolvedAccount> = {
  id: ESP32_CHANNEL_ID,
  meta: {
    id: ESP32_CHANNEL_ID,
    label: "ESP32",
    selectionLabel: "ESP32-S3-BOX-3",
    detailLabel: "ESP32-S3-BOX-3 Desktop Assistant",
    docsPath: "/channels/esp32",
    docsLabel: "esp32",
    blurb: "XiaoZhi-compatible MQTT+UDP desktop assistant channel.",
    systemImage: "desktopcomputer",
    order: 95,
    profile: "optional",
  },
  capabilities: {
    chatTypes: ["direct"],
    media: true,
    nativeCommands: true,
  },
  config: {
    listAccountIds: (cfg) => (isEsp32PluginEnabled(cfg) ? ["default"] : []),
    resolveAccount,
    defaultAccountId: () => "default",
    isEnabled: (account) => account.enabled,
    isConfigured: (account) => account.enabled,
    unconfiguredReason: () =>
      "Enable plugins.entries.esp32.enabled and run crawclaw esp32 pair start.",
    describeAccount: (account, cfg) => {
      const config = readEsp32PluginConfigFromCrawClawConfig(cfg);
      return {
        accountId: account.accountId,
        enabled: account.enabled,
        configured: account.enabled,
        running: Boolean(getEsp32Service()),
        mode: "mqtt-udp",
        port: config.broker.port,
        profile: ESP32_HARDWARE_TARGET,
      };
    },
  },
  setup: {
    applyAccountConfig: ({ cfg }) => ({
      ...cfg,
      plugins: {
        ...cfg.plugins,
        entries: {
          ...cfg.plugins?.entries,
          esp32: {
            ...cfg.plugins?.entries?.esp32,
            enabled: true,
            config: {
              ...cfg.plugins?.entries?.esp32?.config,
            },
          },
        },
      },
    }),
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 72,
    chunker: null,
    sendText: async ({ to, text }) => {
      const service = getEsp32Service();
      if (!service) {
        throw new Error("ESP32 channel service is not running");
      }
      await service.sendDisplayText({ deviceId: to, text });
      return {
        channel: ESP32_CHANNEL_ID,
        messageId: `esp32:${Date.now()}`,
        conversationId: to,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: "default",
      configured: true,
      enabled: true,
      running: false,
      mode: "mqtt-udp",
      profile: ESP32_HARDWARE_TARGET,
    },
    buildAccountSnapshot: ({ account, cfg }) => {
      const config = readEsp32PluginConfigFromCrawClawConfig(cfg);
      return {
        accountId: account.accountId,
        configured: account.enabled,
        enabled: account.enabled,
        running: Boolean(getEsp32Service()),
        connected: (getEsp32Service()?.listOnlineDevices().length ?? 0) > 0,
        mode: "mqtt-udp",
        port: config.broker.port,
        profile: ESP32_HARDWARE_TARGET,
      };
    },
  },
};
