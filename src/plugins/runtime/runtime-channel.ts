import type { PluginRuntime } from "./types.js";

const CHANNEL_RUNTIME_REMOVED_REASON =
  "TypeScript channel runtime has been removed; implement channels as Rust-native plugins.";

function unavailable(): never {
  throw new Error(CHANNEL_RUNTIME_REMOVED_REASON);
}

export function createRuntimeChannel(): PluginRuntime["channel"] {
  return {
    text: {},
    reply: {},
    routing: {},
    pairing: {
      readAllowFromStore: unavailable,
      upsertPairingRequest: unavailable,
    },
    media: {},
    activity: {},
    session: {},
    mentions: {},
    reactions: {},
    groups: {},
    debounce: {},
    commands: {},
    outbound: {
      loadAdapter: unavailable,
    },
    threadBindings: {
      setIdleTimeoutBySessionKey: unavailable,
      setMaxAgeBySessionKey: unavailable,
    },
  } as unknown as PluginRuntime["channel"];
}
