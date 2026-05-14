// Bundled TypeScript channel implementations were removed. Rust-native channel
// plugins can repopulate this catalog through the native registry.
export type ChatChannelId = string & { readonly __chatChannelIdBrand?: never };

export const CHAT_CHANNEL_ORDER: readonly ChatChannelId[] = [];

export const CHANNEL_IDS: readonly ChatChannelId[] = [...CHAT_CHANNEL_ORDER];
