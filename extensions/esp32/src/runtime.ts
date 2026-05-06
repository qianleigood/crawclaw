import type { PluginRuntime } from "../api.js";
import type { Esp32ChannelService } from "./service.js";

let pluginRuntime: PluginRuntime | null = null;
let currentService: Esp32ChannelService | null = null;

export function setEsp32PluginRuntime(runtime: PluginRuntime): void {
  pluginRuntime = runtime;
}

export function getEsp32PluginRuntime(): PluginRuntime | null {
  return pluginRuntime;
}

export function setEsp32Service(service: Esp32ChannelService | null): void {
  currentService = service;
}

export function getEsp32Service(): Esp32ChannelService | null {
  return currentService;
}
