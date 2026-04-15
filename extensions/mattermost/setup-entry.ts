import { defineSetupPluginEntry } from "crawclaw/plugin-sdk/core";
import { mattermostPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(mattermostPlugin);
