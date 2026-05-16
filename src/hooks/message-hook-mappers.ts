import type { FinalizedMsgContext } from "../chat/templating.js";
import type { CrawClawConfig } from "../config/config.js";
import type {
  MessagePreprocessedToolCallPreflightContext,
  MessageReceivedToolCallPreflightContext,
  MessageSentToolCallPreflightContext,
  MessageTranscribedToolCallPreflightContext,
} from "./internal-hooks.js";

export type CanonicalInboundMessageToolCallPreflightContext = {
  from: string;
  to?: string;
  content: string;
  body?: string;
  bodyForAgent?: string;
  transcript?: string;
  timestamp?: number;
  channelId: string;
  accountId?: string;
  conversationId?: string;
  messageId?: string;
  senderId?: string;
  senderName?: string;
  senderUsername?: string;
  senderE164?: string;
  provider?: string;
  surface?: string;
  threadId?: string | number;
  mediaPath?: string;
  mediaType?: string;
  mediaPaths?: string[];
  mediaTypes?: string[];
  originatingChannel?: string;
  originatingTo?: string;
  guildId?: string;
  channelName?: string;
  isGroup: boolean;
  groupId?: string;
};

export type CanonicalSentMessageToolCallPreflightContext = {
  to: string;
  content: string;
  success: boolean;
  error?: string;
  channelId: string;
  accountId?: string;
  conversationId?: string;
  messageId?: string;
  isGroup?: boolean;
  groupId?: string;
};

export function deriveInboundMessageToolCallPreflightContext(
  ctx: FinalizedMsgContext,
  overrides?: {
    content?: string;
    messageId?: string;
  },
): CanonicalInboundMessageToolCallPreflightContext {
  const content =
    overrides?.content ??
    (typeof ctx.BodyForCommands === "string"
      ? ctx.BodyForCommands
      : typeof ctx.RawBody === "string"
        ? ctx.RawBody
        : typeof ctx.Body === "string"
          ? ctx.Body
          : "");
  const channelId = (ctx.OriginatingChannel ?? ctx.Surface ?? ctx.Provider ?? "").toLowerCase();
  const conversationId = ctx.OriginatingTo ?? ctx.To ?? ctx.From ?? undefined;
  const isGroup = Boolean(ctx.GroupSubject || ctx.GroupChannel);
  const mediaPaths = Array.isArray(ctx.MediaPaths)
    ? ctx.MediaPaths.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : undefined;
  const mediaTypes = Array.isArray(ctx.MediaTypes)
    ? ctx.MediaTypes.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : undefined;
  return {
    from: ctx.From ?? "",
    to: ctx.To,
    content,
    body: ctx.Body,
    bodyForAgent: ctx.BodyForAgent,
    transcript: ctx.Transcript,
    timestamp:
      typeof ctx.Timestamp === "number" && Number.isFinite(ctx.Timestamp)
        ? ctx.Timestamp
        : undefined,
    channelId,
    accountId: ctx.AccountId,
    conversationId,
    messageId:
      overrides?.messageId ??
      ctx.MessageSidFull ??
      ctx.MessageSid ??
      ctx.MessageSidFirst ??
      ctx.MessageSidLast,
    senderId: ctx.SenderId,
    senderName: ctx.SenderName,
    senderUsername: ctx.SenderUsername,
    senderE164: ctx.SenderE164,
    provider: ctx.Provider,
    surface: ctx.Surface,
    threadId: ctx.MessageThreadId,
    mediaPath: ctx.MediaPath ?? mediaPaths?.[0],
    mediaType: ctx.MediaType ?? mediaTypes?.[0],
    mediaPaths,
    mediaTypes,
    originatingChannel: ctx.OriginatingChannel,
    originatingTo: ctx.OriginatingTo,
    guildId: ctx.GroupSpace,
    channelName: ctx.GroupChannel,
    isGroup,
    groupId: isGroup ? conversationId : undefined,
  };
}

export function buildCanonicalSentMessageToolCallPreflightContext(params: {
  to: string;
  content: string;
  success: boolean;
  error?: string;
  channelId: string;
  accountId?: string;
  conversationId?: string;
  messageId?: string;
  isGroup?: boolean;
  groupId?: string;
}): CanonicalSentMessageToolCallPreflightContext {
  return {
    to: params.to,
    content: params.content,
    success: params.success,
    error: params.error,
    channelId: params.channelId,
    accountId: params.accountId,
    conversationId: params.conversationId ?? params.to,
    messageId: params.messageId,
    isGroup: params.isGroup,
    groupId: params.groupId,
  };
}

export function toInternalMessageReceivedContext(
  canonical: CanonicalInboundMessageToolCallPreflightContext,
): MessageReceivedToolCallPreflightContext {
  return {
    from: canonical.from,
    content: canonical.content,
    timestamp: canonical.timestamp,
    channelId: canonical.channelId,
    accountId: canonical.accountId,
    conversationId: canonical.conversationId,
    messageId: canonical.messageId,
    metadata: {
      to: canonical.to,
      provider: canonical.provider,
      surface: canonical.surface,
      threadId: canonical.threadId,
      senderId: canonical.senderId,
      senderName: canonical.senderName,
      senderUsername: canonical.senderUsername,
      senderE164: canonical.senderE164,
      guildId: canonical.guildId,
      channelName: canonical.channelName,
    },
  };
}

export function toInternalMessageTranscribedContext(
  canonical: CanonicalInboundMessageToolCallPreflightContext,
  cfg: CrawClawConfig,
): MessageTranscribedToolCallPreflightContext & { cfg: CrawClawConfig } {
  const shared = toInternalInboundMessageToolCallPreflightContextBase(canonical);
  return {
    ...shared,
    transcript: canonical.transcript ?? "",
    cfg,
  };
}

export function toInternalMessagePreprocessedContext(
  canonical: CanonicalInboundMessageToolCallPreflightContext,
  cfg: CrawClawConfig,
): MessagePreprocessedToolCallPreflightContext & { cfg: CrawClawConfig } {
  const shared = toInternalInboundMessageToolCallPreflightContextBase(canonical);
  return {
    ...shared,
    transcript: canonical.transcript,
    isGroup: canonical.isGroup,
    groupId: canonical.groupId,
    cfg,
  };
}

function toInternalInboundMessageToolCallPreflightContextBase(
  canonical: CanonicalInboundMessageToolCallPreflightContext,
) {
  return {
    from: canonical.from,
    to: canonical.to,
    body: canonical.body,
    bodyForAgent: canonical.bodyForAgent,
    timestamp: canonical.timestamp,
    channelId: canonical.channelId,
    conversationId: canonical.conversationId,
    messageId: canonical.messageId,
    senderId: canonical.senderId,
    senderName: canonical.senderName,
    senderUsername: canonical.senderUsername,
    provider: canonical.provider,
    surface: canonical.surface,
    mediaPath: canonical.mediaPath,
    mediaType: canonical.mediaType,
  };
}

export function toInternalMessageSentContext(
  canonical: CanonicalSentMessageToolCallPreflightContext,
): MessageSentToolCallPreflightContext {
  return {
    to: canonical.to,
    content: canonical.content,
    success: canonical.success,
    ...(canonical.error ? { error: canonical.error } : {}),
    channelId: canonical.channelId,
    accountId: canonical.accountId,
    conversationId: canonical.conversationId,
    messageId: canonical.messageId,
    ...(canonical.isGroup != null ? { isGroup: canonical.isGroup } : {}),
    ...(canonical.groupId ? { groupId: canonical.groupId } : {}),
  };
}
