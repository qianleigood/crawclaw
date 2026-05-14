import type { MsgContext } from "../../auto-reply/templating.js";
import { getChannelPlugin } from "../../channels/plugins/index.js";
import type { ChannelId } from "../../channels/plugins/types.js";
import type { CrawClawConfig } from "../../config/config.js";
import { recordSessionMetaFromInbound, resolveStorePath } from "../../config/sessions.js";
import type { RoutePeer } from "../../routing/resolve-route.js";
import { resolveRustOutboundFallbackSessionRoute } from "./message-policy-runtime.js";
import { shouldUseNativeGatewayOutbound } from "./outbound-transport-policy.js";
import type { ResolvedMessagingTarget } from "./target-resolver.js";

export type OutboundSessionRoute = {
  sessionKey: string;
  baseSessionKey: string;
  peer: RoutePeer;
  chatType: "direct" | "group" | "channel";
  from: string;
  to: string;
  threadId?: string | number;
};

export type ResolveOutboundSessionRouteParams = {
  cfg: CrawClawConfig;
  channel: ChannelId;
  agentId: string;
  accountId?: string | null;
  target: string;
  resolvedTarget?: ResolvedMessagingTarget;
  replyToId?: string | null;
  threadId?: string | number | null;
};

function resolveOutboundChannelPlugin(channel: ChannelId) {
  return getChannelPlugin(channel);
}

export async function resolveOutboundSessionRoute(
  params: ResolveOutboundSessionRouteParams,
): Promise<OutboundSessionRoute | null> {
  const target = params.target.trim();
  if (!target) {
    return null;
  }
  const nextParams = { ...params, target };
  if (await shouldUseNativeGatewayOutbound(params.channel)) {
    return await resolveRustOutboundFallbackSessionRoute(nextParams);
  }
  const resolver = resolveOutboundChannelPlugin(params.channel)?.messaging
    ?.resolveOutboundSessionRoute;
  if (resolver) {
    return await resolver(nextParams);
  }
  return await resolveRustOutboundFallbackSessionRoute(nextParams);
}

export async function ensureOutboundSessionEntry(params: {
  cfg: CrawClawConfig;
  agentId: string;
  channel: ChannelId;
  accountId?: string | null;
  route: OutboundSessionRoute;
}): Promise<void> {
  const storePath = resolveStorePath(params.cfg.session?.store, {
    agentId: params.agentId,
  });
  const ctx: MsgContext = {
    From: params.route.from,
    To: params.route.to,
    SessionKey: params.route.sessionKey,
    AccountId: params.accountId ?? undefined,
    ChatType: params.route.chatType,
    Provider: params.channel,
    Surface: params.channel,
    MessageThreadId: params.route.threadId,
    OriginatingChannel: params.channel,
    OriginatingTo: params.route.to,
  };
  try {
    await recordSessionMetaFromInbound({
      storePath,
      sessionKey: params.route.sessionKey,
      ctx,
    });
  } catch {
    // Do not block outbound sends on session meta writes.
  }
}
