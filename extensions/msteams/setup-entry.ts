import { defineSetupPluginEntry } from "crawclaw/plugin-sdk/core";
import { msteamsPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(msteamsPlugin);
