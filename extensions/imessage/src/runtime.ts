import type { PluginRuntime } from "crawclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "crawclaw/plugin-sdk/runtime-store";

const { setRuntime: setIMessageRuntime, getRuntime: getIMessageRuntime } =
  createPluginRuntimeStore<PluginRuntime>("iMessage runtime not initialized");
export { getIMessageRuntime, setIMessageRuntime };
