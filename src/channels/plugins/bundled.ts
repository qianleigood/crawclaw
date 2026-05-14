import type { PluginRuntime } from "../../plugins/runtime/types.js";
import type { ChannelId, ChannelPlugin } from "./types.js";

export const BUNDLED_TS_CHANNEL_RUNTIME_REMOVED_REASON =
  "bundled TypeScript channel runtime has been removed; implement channels as Rust-native adapters";

export function listBundledChannelPlugins(): readonly ChannelPlugin[] {
  return [];
}

export function listBundledChannelSetupPlugins(): readonly ChannelPlugin[] {
  return [];
}

export function getBundledChannelPlugin(_id: ChannelId): ChannelPlugin | undefined {
  return undefined;
}

export function requireBundledChannelPlugin(id: ChannelId): ChannelPlugin {
  throw new Error(`missing bundled Rust-native channel plugin: ${id}`);
}

export function setBundledChannelRuntime(id: ChannelId, _runtime: PluginRuntime): void {
  throw new Error(`${id}: ${BUNDLED_TS_CHANNEL_RUNTIME_REMOVED_REASON}`);
}
