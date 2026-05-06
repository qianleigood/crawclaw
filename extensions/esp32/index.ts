import { defineChannelPluginEntry } from "crawclaw/plugin-sdk/core";
import { createEsp32CallTool } from "./src/agent-tool.js";
import { esp32ChannelPlugin } from "./src/channel.js";
import { registerEsp32Cli } from "./src/cli.js";
import { esp32PluginConfigSchema } from "./src/config.js";
import { setEsp32PluginRuntime, setEsp32Service } from "./src/runtime.js";
import { createEsp32ChannelService } from "./src/service.js";

export { createEsp32CallTool } from "./src/agent-tool.js";
export { esp32ChannelPlugin } from "./src/channel.js";
export { esp32PluginConfigSchema, resolveEsp32PluginConfig } from "./src/config.js";
export { setEsp32PluginRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "esp32",
  name: "ESP32",
  description: "ESP32-S3-BOX-3 MQTT+UDP channel plugin for CrawClaw",
  plugin: esp32ChannelPlugin,
  configSchema: esp32PluginConfigSchema,
  setRuntime: setEsp32PluginRuntime,
  registerCliMetadata(api) {
    api.registerCli(registerEsp32Cli(api), {
      commands: ["esp32"],
      descriptors: [
        {
          name: "esp32",
          description: "Manage ESP32-S3-BOX-3 devices",
          descriptionZhCN: "管理 ESP32-S3-BOX-3 设备",
          hasSubcommands: true,
        },
      ],
    });
  },
  registerFull(api) {
    api.registerService(createEsp32ChannelService(api));
    api.registerTool(createEsp32CallTool(api), { name: "esp32_call_tool", optional: true });
  },
});
