import type { ChannelOutboundAdapter } from "../src/channels/plugins/types.js";
import { loadBundledPluginPublicSurfaceSync } from "../src/test-utils/bundled-plugin-public-surface.js";

function requireOutboundAdapter(
  pluginId: string,
  plugin: { outbound?: ChannelOutboundAdapter },
): ChannelOutboundAdapter {
  if (!plugin.outbound) {
    throw new Error(`${pluginId} outbound unavailable`);
  }
  return plugin.outbound;
}

const { discordPlugin } = loadBundledPluginPublicSurfaceSync<{
  discordPlugin: { outbound?: ChannelOutboundAdapter };
}>({
  pluginId: "discord",
  artifactBasename: "index.js",
});
export const discordOutbound = requireOutboundAdapter("discord", discordPlugin);
const { imessagePlugin } = loadBundledPluginPublicSurfaceSync<{
  imessagePlugin: { outbound?: ChannelOutboundAdapter };
}>({
  pluginId: "imessage",
  artifactBasename: "index.js",
});
export const imessageOutbound = requireOutboundAdapter("imessage", imessagePlugin);
const { signalPlugin } = loadBundledPluginPublicSurfaceSync<{
  signalPlugin: { outbound?: ChannelOutboundAdapter };
}>({
  pluginId: "signal",
  artifactBasename: "index.js",
});
export const signalOutbound = requireOutboundAdapter("signal", signalPlugin);
const { slackPlugin } = loadBundledPluginPublicSurfaceSync<{
  slackPlugin: { outbound?: ChannelOutboundAdapter };
}>({
  pluginId: "slack",
  artifactBasename: "index.js",
});
export const slackOutbound = requireOutboundAdapter("slack", slackPlugin);
export const { telegramOutbound } = loadBundledPluginPublicSurfaceSync<{
  telegramOutbound: ChannelOutboundAdapter;
}>({
  pluginId: "telegram",
  artifactBasename: "src/outbound-adapter.js",
});
const { whatsappPlugin } = loadBundledPluginPublicSurfaceSync<{
  whatsappPlugin: { outbound?: ChannelOutboundAdapter };
}>({
  pluginId: "whatsapp",
  artifactBasename: "index.js",
});
export const whatsappOutbound = requireOutboundAdapter("whatsapp", whatsappPlugin);
