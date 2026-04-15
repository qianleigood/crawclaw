import { defineSetupPluginEntry } from "crawclaw/plugin-sdk/core";
import { zaloPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(zaloPlugin);
