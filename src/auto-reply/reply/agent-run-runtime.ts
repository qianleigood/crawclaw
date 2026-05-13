import { randomUUID } from "node:crypto";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { resolveModelRefFromString } from "../../agents/model-selection.js";
import { runCrawClawRuntimeTool } from "../../agents/runtime-tools/native.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import type { CrawClawConfig } from "../../config/config.js";
import { normalizeMessageChannel } from "../../utils/message-channel.js";
import type { FinalizedMsgContext } from "../templating.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { resolveDefaultModel } from "./directive-handling.defaults.js";
import type { ReplyDispatcher, ReplyDispatchKind } from "./reply-dispatcher.js";

type RustChatType = "direct" | "group" | "channel" | "thread";

type RustAgentReplyOptions = Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;

type RustReplyPayload = {
  text?: unknown;
  mediaUrl?: unknown;
  mediaUrls?: unknown;
  metadata?: unknown;
};

type RustAgentRunEvent =
  | {
      type: "runStarted";
      runId?: unknown;
      agentId?: unknown;
      sessionKey?: unknown;
    }
  | {
      type: "modelChunk";
      runId?: unknown;
      text?: unknown;
    }
  | {
      type: "replyPayload";
      runId?: unknown;
      payload?: RustReplyPayload;
    }
  | {
      type: "toolResult";
      runId?: unknown;
      result?: unknown;
      isError?: unknown;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

type RustAgentRunResult = {
  runId: string;
  sessionKey: string;
  assistantText?: string;
  events?: RustAgentRunEvent[];
};

type RustAgentDispatchResult = {
  queuedFinal: boolean;
  counts: Record<ReplyDispatchKind, number>;
};

function trimString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringifyIdentifier(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function resolveSessionKey(ctx: FinalizedMsgContext): string | undefined {
  const commandTarget =
    ctx.CommandSource === "native" ? trimString(ctx.CommandTargetSessionKey) : undefined;
  return (
    commandTarget ??
    trimString(ctx.SessionKey) ??
    stringifyIdentifier(ctx.MessageThreadId) ??
    trimString(ctx.NativeChannelId)
  );
}

function resolveChatType(raw?: string): RustChatType {
  switch (raw?.trim().toLowerCase()) {
    case "group":
    case "supergroup":
      return "group";
    case "channel":
      return "channel";
    case "thread":
    case "topic":
      return "thread";
    default:
      return "direct";
  }
}

function compactMetadata(values: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    metadata[key] = value;
  }
  return metadata;
}

function resolveInboundBody(ctx: FinalizedMsgContext): string {
  return (
    trimString(ctx.BodyForAgent) ??
    trimString(ctx.Body) ??
    trimString(ctx.CommandBody) ??
    trimString(ctx.RawBody) ??
    ""
  );
}

function resolveRawBody(ctx: FinalizedMsgContext): string | undefined {
  return trimString(ctx.CommandBody) ?? trimString(ctx.RawBody) ?? trimString(ctx.Body);
}

function resolveInboundMediaUrls(ctx: FinalizedMsgContext): string[] {
  const urls = Array.isArray(ctx.MediaUrls) ? ctx.MediaUrls : [];
  const single = trimString(ctx.MediaUrl);
  const candidates = [...urls, single].filter(
    (url): url is string => typeof url === "string" && !!url.trim(),
  );
  return Array.from(new Set(candidates.map((url) => url.trim())));
}

function buildAgentRunRequest(params: {
  ctx: FinalizedMsgContext;
  cfg: CrawClawConfig;
  runId: string;
  replyOptions?: RustAgentReplyOptions;
}) {
  const { ctx, cfg, runId } = params;
  const sessionKey = resolveSessionKey(ctx);
  const agentId = resolveSessionAgentId({ sessionKey, config: cfg });
  const resolvedSessionKey = sessionKey ?? `agent:${agentId}:main`;
  const { defaultProvider, defaultModel, aliasIndex } = resolveDefaultModel({ cfg, agentId });
  let provider = defaultProvider;
  let model = defaultModel;
  const heartbeatModelOverride = trimString(params.replyOptions?.heartbeatModelOverride);
  if (params.replyOptions?.isHeartbeat === true && heartbeatModelOverride) {
    const heartbeatRef = resolveModelRefFromString({
      raw: heartbeatModelOverride,
      defaultProvider,
      aliasIndex,
    });
    if (heartbeatRef) {
      provider = heartbeatRef.ref.provider;
      model = heartbeatRef.ref.model;
    }
  }
  const channel = normalizeMessageChannel(ctx.Surface ?? ctx.Provider) ?? "gateway";
  const messageId =
    trimString(ctx.MessageSidFull) ??
    trimString(ctx.MessageSid) ??
    trimString(ctx.MessageSidLast) ??
    trimString(ctx.MessageSidFirst);

  return {
    runId,
    agentId,
    sessionKey: resolvedSessionKey,
    inbound: {
      channel,
      accountId: trimString(ctx.AccountId),
      from: trimString(ctx.From) ?? trimString(ctx.SenderId) ?? "user",
      to: trimString(ctx.To) ?? trimString(ctx.OriginatingTo) ?? "agent:main",
      chatType: resolveChatType(ctx.ChatType),
      body: resolveInboundBody(ctx),
      rawBody: resolveRawBody(ctx),
      messageId,
      threadId: stringifyIdentifier(ctx.MessageThreadId) ?? trimString(ctx.SessionKey),
      mediaUrls: resolveInboundMediaUrls(ctx),
      metadata: compactMetadata({
        provider: ctx.Provider,
        surface: ctx.Surface,
        senderName: ctx.SenderName,
        senderUsername: ctx.SenderUsername,
        originatingChannel: ctx.OriginatingChannel,
        originatingTo: ctx.OriginatingTo,
        replyToId: ctx.ReplyToIdFull ?? ctx.ReplyToId,
        rootMessageId: ctx.RootMessageId,
        messageSids: ctx.MessageSids,
        commandSource: ctx.CommandSource,
        commandAuthorized: ctx.CommandAuthorized,
      }),
    },
    model: {
      provider,
      model,
    },
    enabledTools: [],
    options: compactMetadata({
      heartbeat: params.replyOptions?.isHeartbeat === true ? true : undefined,
      heartbeatModelOverride,
      bootstrapContextMode: params.replyOptions?.bootstrapContextMode,
      suppressToolErrorWarnings:
        params.replyOptions?.suppressToolErrorWarnings === true ? true : undefined,
    }),
  };
}

function metadataRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function toReplyPayload(payload: RustReplyPayload | undefined): ReplyPayload | null {
  if (!payload) {
    return null;
  }
  const reply: ReplyPayload = {};
  const text = trimString(payload.text);
  if (text) {
    reply.text = text;
  }
  const mediaUrl = trimString(payload.mediaUrl);
  if (mediaUrl) {
    reply.mediaUrl = mediaUrl;
  }
  if (Array.isArray(payload.mediaUrls)) {
    const mediaUrls = payload.mediaUrls.filter(
      (url): url is string => typeof url === "string" && !!url.trim(),
    );
    if (mediaUrls.length > 0) {
      reply.mediaUrls = mediaUrls;
    }
  }

  const metadata = metadataRecord(payload.metadata);
  if (metadata) {
    if (metadata.isError === true) {
      reply.isError = true;
    }
    const replyToId = trimString(metadata.replyToId);
    if (replyToId) {
      reply.replyToId = replyToId;
    }
    const channelData = metadataRecord(metadata.channelData);
    if (channelData) {
      reply.channelData = channelData;
    }
  }

  return Object.keys(reply).length > 0 ? reply : null;
}

function createAbortError(): Error {
  const error = new Error("Agent run aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export async function dispatchInboundWithRustAgent(params: {
  ctx: FinalizedMsgContext;
  cfg: CrawClawConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: RustAgentReplyOptions;
}): Promise<RustAgentDispatchResult> {
  const runId = trimString(params.replyOptions?.runId) ?? randomUUID();
  const request = buildAgentRunRequest({
    ctx: params.ctx,
    cfg: params.cfg,
    runId,
    replyOptions: params.replyOptions,
  });
  params.replyOptions?.onAgentRunStart?.(runId);
  params.replyOptions?.onModelSelected?.({
    provider: request.model.provider,
    model: request.model.model,
    thinkLevel: undefined,
  });

  throwIfAborted(params.replyOptions?.abortSignal);
  const result = await withAbort(
    runCrawClawRuntimeTool<RustAgentRunResult>("agent_run_turn", request, {
      timeoutMs: resolveAgentTimeoutMs({
        cfg: params.cfg,
        overrideSeconds: params.replyOptions?.timeoutOverrideSeconds,
      }),
    }),
    params.replyOptions?.abortSignal,
  );
  throwIfAborted(params.replyOptions?.abortSignal);

  let queuedFinal = false;
  let replyStarted = false;
  const sendFinal = async (payload: ReplyPayload) => {
    if (!replyStarted) {
      replyStarted = true;
      await params.replyOptions?.onReplyStart?.();
    }
    queuedFinal = params.dispatcher.sendFinalReply(payload) || queuedFinal;
  };

  for (const event of result.events ?? []) {
    if (event.type === "modelChunk" && typeof event.text === "string" && event.text) {
      await params.replyOptions?.onPartialReply?.({ text: event.text });
      continue;
    }
    if (event.type !== "replyPayload") {
      continue;
    }
    const payload = toReplyPayload(metadataRecord(event.payload));
    if (payload) {
      await sendFinal(payload);
    }
  }

  if (!queuedFinal) {
    const fallbackText = trimString(result.assistantText);
    if (fallbackText) {
      await sendFinal({ text: fallbackText });
    }
  }

  return {
    queuedFinal,
    counts: params.dispatcher.getQueuedCounts(),
  };
}
