import {
  buildChannelConfigSchema,
  WhatsAppConfigSchema,
} from "crawclaw/plugin-sdk/channel-config-schema";
import { whatsAppChannelConfigUiHints } from "./config-ui-hints.js";

export const WhatsAppChannelConfigSchema = buildChannelConfigSchema(WhatsAppConfigSchema, {
  uiHints: whatsAppChannelConfigUiHints,
});
