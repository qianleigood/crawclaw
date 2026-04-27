import { defineSetupPluginEntry } from "crawclaw/plugin-sdk/core";
import { weixinPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(weixinPlugin);
