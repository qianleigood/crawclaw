import type { PluginRuntime } from "crawclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "crawclaw/plugin-sdk/runtime-store";

const { setRuntime: setDiscordRuntime, getRuntime: getDiscordRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Discord runtime not initialized");
export { getDiscordRuntime, setDiscordRuntime };
