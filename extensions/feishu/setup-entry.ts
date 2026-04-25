import { defineSetupPluginEntry } from "crawclaw/plugin-sdk/core";
import { feishuSetupPlugin } from "./src/channel.setup.js";

export { feishuSetupPlugin } from "./src/channel.setup.js";

export default defineSetupPluginEntry(feishuSetupPlugin);
