import type { PluginRuntime } from "crawclaw/plugin-sdk/plugin-runtime";
import { createPluginRuntimeStore } from "crawclaw/plugin-sdk/runtime-store";

const { setRuntime: setTlonRuntime, getRuntime: getTlonRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Tlon runtime not initialized");
export { getTlonRuntime, setTlonRuntime };
