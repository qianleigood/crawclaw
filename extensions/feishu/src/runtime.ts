import { createPluginRuntimeStore } from "crawclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "../runtime-api.js";

const {
  setRuntime: setFeishuRuntime,
  clearRuntime: clearFeishuRuntime,
  getRuntime: getFeishuRuntime,
} = createPluginRuntimeStore<PluginRuntime>("Feishu runtime not initialized");
export { clearFeishuRuntime, getFeishuRuntime, setFeishuRuntime };
