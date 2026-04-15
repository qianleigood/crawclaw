import {
  buildChannelConfigSchema,
  GoogleChatConfigSchema,
} from "crawclaw/plugin-sdk/channel-config-schema";

export const GoogleChatChannelConfigSchema = buildChannelConfigSchema(GoogleChatConfigSchema);
