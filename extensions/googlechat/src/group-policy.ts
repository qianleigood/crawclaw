import { resolveChannelGroupRequireMention } from "crawclaw/plugin-sdk/channel-policy";
import type { CrawClawConfig } from "crawclaw/plugin-sdk/core";

type GoogleChatGroupContext = {
  cfg: CrawClawConfig;
  accountId?: string | null;
  groupId?: string | null;
};

export function resolveGoogleChatGroupRequireMention(params: GoogleChatGroupContext): boolean {
  return resolveChannelGroupRequireMention({
    cfg: params.cfg,
    channel: "googlechat",
    groupId: params.groupId,
    accountId: params.accountId,
  });
}
