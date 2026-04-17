import type { OriginatingChannelType } from "../auto-reply/templating.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { ReplyToMode } from "../config/types.js";
import { resolveAllowExplicitReplyTagsWhenOff } from "./reply-to-mode.js";

export function createReplyToModeFilter(
  mode: ReplyToMode,
  opts: { allowExplicitReplyTagsWhenOff?: boolean } = {},
) {
  let hasThreaded = false;
  return (payload: ReplyPayload): ReplyPayload => {
    if (!payload.replyToId) {
      return payload;
    }
    if (mode === "off") {
      const isExplicit = Boolean(payload.replyToTag) || Boolean(payload.replyToCurrent);
      if (opts.allowExplicitReplyTagsWhenOff && isExplicit && !payload.isCompactionNotice) {
        return payload;
      }
      return { ...payload, replyToId: undefined };
    }
    if (mode === "all") {
      return payload;
    }
    if (hasThreaded) {
      if (payload.isCompactionNotice) {
        return payload;
      }
      return { ...payload, replyToId: undefined };
    }
    if (!payload.isCompactionNotice) {
      hasThreaded = true;
    }
    return payload;
  };
}

export function createReplyToModeFilterForChannel(
  mode: ReplyToMode,
  channel?: OriginatingChannelType,
) {
  return createReplyToModeFilter(mode, {
    allowExplicitReplyTagsWhenOff: resolveAllowExplicitReplyTagsWhenOff(channel),
  });
}
