import { normalizeConversationText } from "../../acp/conversation-id.js";
import { resolveConversationBindingContextFromMessage } from "../../channels/conversation-binding-input.js";
import type { CrawClawConfig } from "../../config/config.js";
import { getSessionBindingService } from "../../infra/outbound/session-binding-service.js";
import type { MsgContext } from "../templating.js";
import { resolveEffectiveResetTargetSessionKey } from "./acp-reset-target.js";

export type SessionConversationBindingContext = {
  channel: string;
  accountId: string;
  conversationId: string;
  parentConversationId?: string;
};

export function resolveSessionConversationBindingContext(
  cfg: CrawClawConfig,
  ctx: MsgContext,
): SessionConversationBindingContext | null {
  const bindingContext = resolveConversationBindingContextFromMessage({
    cfg,
    ctx,
  });
  if (!bindingContext) {
    return null;
  }
  return {
    channel: bindingContext.channel,
    accountId: bindingContext.accountId,
    conversationId: bindingContext.conversationId,
    ...(bindingContext.parentConversationId
      ? { parentConversationId: bindingContext.parentConversationId }
      : {}),
  };
}

function resolveBoundConversationSessionKey(params: {
  cfg: CrawClawConfig;
  ctx: MsgContext;
  bindingContext?: SessionConversationBindingContext | null;
}): string | undefined {
  const bindingContext =
    params.bindingContext ?? resolveSessionConversationBindingContext(params.cfg, params.ctx);
  if (!bindingContext) {
    return undefined;
  }
  const binding = getSessionBindingService().resolveByConversation({
    channel: bindingContext.channel,
    accountId: bindingContext.accountId,
    conversationId: bindingContext.conversationId,
    ...(bindingContext.parentConversationId
      ? { parentConversationId: bindingContext.parentConversationId }
      : {}),
  });
  if (!binding?.targetSessionKey) {
    return undefined;
  }
  getSessionBindingService().touch(binding.bindingId);
  return binding.targetSessionKey;
}

function resolveBoundAcpSessionForReset(params: {
  cfg: CrawClawConfig;
  ctx: MsgContext;
  bindingContext?: SessionConversationBindingContext | null;
}): string | undefined {
  const activeSessionKey = normalizeConversationText(params.ctx.SessionKey);
  const bindingContext =
    params.bindingContext ?? resolveSessionConversationBindingContext(params.cfg, params.ctx);
  return resolveEffectiveResetTargetSessionKey({
    cfg: params.cfg,
    channel: bindingContext?.channel,
    accountId: bindingContext?.accountId,
    conversationId: bindingContext?.conversationId,
    parentConversationId: bindingContext?.parentConversationId,
    activeSessionKey,
    allowNonAcpBindingSessionKey: false,
    skipConfiguredFallbackWhenActiveSessionNonAcp: true,
    fallbackToActiveAcpWhenUnbound: false,
  });
}

export function resolveSessionTargetContext(params: { cfg: CrawClawConfig; ctx: MsgContext }): {
  bindingContext: SessionConversationBindingContext | null;
  targetSessionKey?: string;
  sessionCtxForState: MsgContext;
  boundAcpSessionKey?: string;
  shouldUseAcpInPlaceReset: boolean;
} {
  const bindingContext = resolveSessionConversationBindingContext(params.cfg, params.ctx);
  const commandTargetSessionKey =
    params.ctx.CommandSource === "native" ? params.ctx.CommandTargetSessionKey?.trim() : undefined;
  const targetSessionKey =
    resolveBoundConversationSessionKey({
      cfg: params.cfg,
      ctx: params.ctx,
      bindingContext,
    }) ?? commandTargetSessionKey;
  const sessionCtxForState =
    targetSessionKey && targetSessionKey !== params.ctx.SessionKey
      ? { ...params.ctx, SessionKey: targetSessionKey }
      : params.ctx;
  const boundAcpSessionKey = resolveBoundAcpSessionForReset({
    cfg: params.cfg,
    ctx: sessionCtxForState,
    bindingContext,
  });
  return {
    bindingContext,
    targetSessionKey,
    sessionCtxForState,
    boundAcpSessionKey,
    shouldUseAcpInPlaceReset: Boolean(boundAcpSessionKey),
  };
}
