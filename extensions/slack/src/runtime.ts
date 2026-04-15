import type { PluginRuntime } from "crawclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "crawclaw/plugin-sdk/runtime-store";

const {
  setRuntime: setSlackRuntime,
  clearRuntime: clearSlackRuntime,
  getRuntime: getSlackRuntime,
} = createPluginRuntimeStore<PluginRuntime>("Slack runtime not initialized");
export { clearSlackRuntime, getSlackRuntime, setSlackRuntime };
