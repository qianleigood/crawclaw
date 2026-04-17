import type { OriginatingChannelType } from "../auto-reply/templating.js";
import type { CrawClawConfig } from "../config/config.js";
import type { ReplyToMode } from "../config/types.js";
import { getChannelPlugin, normalizeChannelId } from "./plugins/index.js";

export function resolveReplyToMode(
  cfg: CrawClawConfig,
  channel?: OriginatingChannelType,
  accountId?: string | null,
  chatType?: string | null,
): ReplyToMode {
  const provider = normalizeChannelId(channel);
  if (!provider) {
    return "all";
  }
  const resolved = getChannelPlugin(provider)?.threading?.resolveReplyToMode?.({
    cfg,
    accountId,
    chatType,
  });
  return resolved ?? "all";
}

export function resolveAllowExplicitReplyTagsWhenOff(channel?: OriginatingChannelType): boolean {
  const provider = normalizeChannelId(channel);
  const normalized = typeof channel === "string" ? channel.trim().toLowerCase() : undefined;
  const isWebchat = normalized === "webchat";
  const threading = provider ? getChannelPlugin(provider)?.threading : undefined;
  return provider
    ? (threading?.allowExplicitReplyTagsWhenOff ?? threading?.allowTagsWhenOff ?? true)
    : isWebchat;
}
