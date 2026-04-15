import {
  buildChannelConfigSchema,
  MSTeamsConfigSchema,
} from "crawclaw/plugin-sdk/channel-config-schema";
import { msTeamsChannelConfigUiHints } from "./config-ui-hints.js";

export const MSTeamsChannelConfigSchema = buildChannelConfigSchema(MSTeamsConfigSchema, {
  uiHints: msTeamsChannelConfigUiHints,
});
