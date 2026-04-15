import { defineSetupPluginEntry } from "crawclaw/plugin-sdk/core";
import { matrixPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(matrixPlugin);
