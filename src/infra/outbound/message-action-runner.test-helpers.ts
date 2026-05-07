import type { ChannelPlugin } from "../../channels/plugins/types.plugin.js";
import type { CrawClawConfig } from "../../config/config.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import { createPluginRuntime, type PluginRuntime } from "../../plugins/runtime/index.js";
import { loadBundledPluginPublicSurfaceSync } from "../../test-utils/bundled-plugin-public-surface.js";
import { createTestRegistry } from "../../test-utils/channel-plugins.js";

const { slackPlugin, setSlackRuntime } = loadBundledPluginPublicSurfaceSync<{
  slackPlugin: ChannelPlugin;
  setSlackRuntime: (runtime: PluginRuntime) => void;
}>({
  pluginId: "slack",
  artifactBasename: "index.js",
});
const { telegramPlugin, setTelegramRuntime } = loadBundledPluginPublicSurfaceSync<{
  telegramPlugin: ChannelPlugin;
  setTelegramRuntime: (runtime: PluginRuntime) => void;
}>({
  pluginId: "telegram",
  artifactBasename: "index.js",
});

export const slackConfig = {
  channels: {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    },
  },
} as CrawClawConfig;

export const telegramConfig = {
  channels: {
    telegram: {
      botToken: "telegram-test",
    },
  },
} as CrawClawConfig;

export function installMessageActionRunnerTestRegistry() {
  const runtime = createPluginRuntime();
  setSlackRuntime(runtime);
  setTelegramRuntime(runtime);
  setActivePluginRegistry(
    createTestRegistry([
      {
        pluginId: "slack",
        source: "test",
        plugin: slackPlugin,
      },
      {
        pluginId: "telegram",
        source: "test",
        plugin: telegramPlugin,
      },
    ]),
  );
}

export function resetMessageActionRunnerTestRegistry() {
  setActivePluginRegistry(createTestRegistry([]));
}
