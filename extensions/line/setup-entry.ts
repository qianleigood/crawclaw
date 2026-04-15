import { defineSetupPluginEntry } from "crawclaw/plugin-sdk/core";
import { lineSetupPlugin } from "./src/channel.setup.js";

export { lineSetupPlugin } from "./src/channel.setup.js";

export default defineSetupPluginEntry(lineSetupPlugin);
