import { defineSetupPluginEntry } from "crawclaw/plugin-sdk/core";
import { nostrPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(nostrPlugin);
