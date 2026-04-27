import type { ChannelPlugin } from "crawclaw/plugin-sdk/core";
import { defineChannelPluginEntry } from "crawclaw/plugin-sdk/core";
import { weixinPlugin } from "./src/channel.js";
import { setWeixinRuntime } from "./src/runtime.js";

export { weixinPlugin } from "./src/channel.js";
export { setWeixinRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "weixin",
  name: "Weixin",
  description: "Weixin channel plugin",
  plugin: weixinPlugin as ChannelPlugin,
  setRuntime: setWeixinRuntime,
});
