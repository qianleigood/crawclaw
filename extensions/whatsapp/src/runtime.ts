import type { PluginRuntime } from "crawclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "crawclaw/plugin-sdk/runtime-store";

const { setRuntime: setWhatsAppRuntime, getRuntime: getWhatsAppRuntime } =
  createPluginRuntimeStore<PluginRuntime>("WhatsApp runtime not initialized");
export { getWhatsAppRuntime, setWhatsAppRuntime };
