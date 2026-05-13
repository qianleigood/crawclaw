import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { shouldAllowBundledTsChannelRuntime } from "../../channels/plugins/bundled-runtime-policy.js";
import { dispatchChannelMessageAction } from "../../channels/plugins/message-action-dispatch.js";
import type { ChannelId, ChannelThreadingToolContext } from "../../channels/plugins/types.js";
import type { CrawClawConfig } from "../../config/config.js";
import { appendAssistantMessageToSessionTranscript } from "../../config/sessions.js";
import type { OutboundMediaAccess, OutboundMediaReadFile } from "../../media/load-options.js";
import { resolveAgentScopedOutboundMediaAccess } from "../../media/read-capability.js";
import { listBundledPluginMetadata } from "../../plugins/bundled-plugin-metadata.js";
import type { GatewayClientMode, GatewayClientName } from "../../utils/message-channel.js";
import { throwIfAborted } from "./abort.js";
import type { OutboundSendDeps } from "./deliver.js";
import { buildRustChannelOutboundRequest } from "./message-policy-runtime.js";
import type { MessagePollResult, MessageSendResult } from "./message.js";
import { sendMessage, sendPoll } from "./message.js";
import type { OutboundMirror } from "./mirror.js";
import { extractToolPayload } from "./tool-payload.js";

export type OutboundGatewayContext = {
  url?: string;
  token?: string;
  timeoutMs?: number;
  clientName: GatewayClientName;
  clientDisplayName?: string;
  mode: GatewayClientMode;
};

export type OutboundSendContext = {
  cfg: CrawClawConfig;
  channel: ChannelId;
  params: Record<string, unknown>;
  /** Active agent id for per-agent outbound media root scoping. */
  agentId?: string;
  sessionKey?: string;
  requesterAccountId?: string;
  requesterSenderId?: string;
  requesterSenderName?: string;
  requesterSenderUsername?: string;
  requesterSenderE164?: string;
  mediaAccess?: OutboundMediaAccess;
  mediaReadFile?: OutboundMediaReadFile;
  accountId?: string | null;
  senderIsOwner?: boolean;
  sessionId?: string;
  gateway?: OutboundGatewayContext;
  toolContext?: ChannelThreadingToolContext;
  deps?: OutboundSendDeps;
  dryRun: boolean;
  mirror?: OutboundMirror;
  abortSignal?: AbortSignal;
  silent?: boolean;
};

type PluginHandledResult = {
  handledBy: "plugin";
  payload: unknown;
  toolResult: AgentToolResult<unknown>;
};

let cachedBundledChannelIds: Set<string> | null = null;

function listBundledChannelIds(): Set<string> {
  if (cachedBundledChannelIds) {
    return cachedBundledChannelIds;
  }
  const ids = new Set<string>();
  for (const entry of listBundledPluginMetadata({
    includeChannelConfigs: false,
    includeSyntheticChannelConfigs: false,
  })) {
    for (const channel of entry.manifest.channels ?? []) {
      ids.add(channel);
    }
  }
  cachedBundledChannelIds = ids;
  return ids;
}

export function shouldUseNativeGatewayOutbound(channel: ChannelId): boolean {
  return !shouldAllowBundledTsChannelRuntime() && listBundledChannelIds().has(channel);
}

function collectActionMediaSources(params: Record<string, unknown>): string[] {
  const sources: string[] = [];
  for (const key of ["media", "mediaUrl", "path", "filePath", "fileUrl"] as const) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) {
      sources.push(value);
    }
  }
  return sources;
}

async function tryHandleWithPluginAction(params: {
  ctx: OutboundSendContext;
  action: "send" | "poll";
  onHandled?: () => Promise<void> | void;
}): Promise<PluginHandledResult | null> {
  if (params.ctx.dryRun) {
    return null;
  }
  if (shouldUseNativeGatewayOutbound(params.ctx.channel)) {
    return null;
  }
  const mediaAccess = resolveAgentScopedOutboundMediaAccess({
    cfg: params.ctx.cfg,
    agentId: params.ctx.agentId ?? params.ctx.mirror?.agentId,
    mediaSources: collectActionMediaSources(params.ctx.params),
    sessionKey: params.ctx.sessionKey,
    messageProvider: params.ctx.sessionKey ? undefined : params.ctx.channel,
    accountId:
      (params.ctx.sessionKey
        ? (params.ctx.requesterAccountId ?? params.ctx.accountId)
        : params.ctx.accountId) ?? undefined,
    requesterSenderId: params.ctx.requesterSenderId,
    requesterSenderName: params.ctx.requesterSenderName,
    requesterSenderUsername: params.ctx.requesterSenderUsername,
    requesterSenderE164: params.ctx.requesterSenderE164,
    mediaAccess: params.ctx.mediaAccess,
    mediaReadFile: params.ctx.mediaReadFile,
  });
  const handled = await dispatchChannelMessageAction({
    channel: params.ctx.channel,
    action: params.action,
    cfg: params.ctx.cfg,
    params: params.ctx.params,
    mediaAccess,
    mediaLocalRoots: mediaAccess.localRoots,
    mediaReadFile: mediaAccess.readFile,
    accountId: params.ctx.accountId ?? undefined,
    requesterSenderId: params.ctx.requesterSenderId,
    senderIsOwner: params.ctx.senderIsOwner,
    sessionKey: params.ctx.sessionKey,
    sessionId: params.ctx.sessionId,
    agentId: params.ctx.agentId,
    gateway: params.ctx.gateway,
    toolContext: params.ctx.toolContext,
    dryRun: params.ctx.dryRun,
  });
  if (!handled) {
    return null;
  }
  await params.onHandled?.();
  return {
    handledBy: "plugin",
    payload: extractToolPayload(handled),
    toolResult: handled,
  };
}

export async function executeSendAction(params: {
  ctx: OutboundSendContext;
  to: string;
  message: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  gifPlayback?: boolean;
  forceDocument?: boolean;
  bestEffort?: boolean;
  replyToId?: string;
  threadId?: string | number;
}): Promise<{
  handledBy: "plugin" | "core";
  payload: unknown;
  toolResult?: AgentToolResult<unknown>;
  sendResult?: MessageSendResult;
}> {
  throwIfAborted(params.ctx.abortSignal);
  const nativeGateway = shouldUseNativeGatewayOutbound(params.ctx.channel);
  const pluginHandled = await tryHandleWithPluginAction({
    ctx: params.ctx,
    action: "send",
    onHandled: async () => {
      if (!params.ctx.mirror) {
        return;
      }
      const mirrorText = params.ctx.mirror.text ?? params.message;
      const mirrorMediaUrls =
        params.ctx.mirror.mediaUrls ??
        params.mediaUrls ??
        (params.mediaUrl ? [params.mediaUrl] : undefined);
      await appendAssistantMessageToSessionTranscript({
        agentId: params.ctx.mirror.agentId,
        sessionKey: params.ctx.mirror.sessionKey,
        text: mirrorText,
        mediaUrls: mirrorMediaUrls,
        idempotencyKey: params.ctx.mirror.idempotencyKey,
      });
    },
  });
  if (pluginHandled) {
    return pluginHandled;
  }

  throwIfAborted(params.ctx.abortSignal);
  const outboundRequest = await buildRustChannelOutboundRequest({
    requestId: params.ctx.mirror?.idempotencyKey ?? `send:${Date.now()}`,
    channel: params.ctx.channel,
    accountId: params.ctx.accountId ?? undefined,
    action: "send",
    to: params.to,
    text: params.message,
    mediaUrls: params.mediaUrls ?? (params.mediaUrl ? [params.mediaUrl] : []),
    replyToId: params.replyToId,
    threadId: params.threadId == null ? undefined : String(params.threadId),
    params: params.ctx.params,
  });
  const outboundMediaUrls = outboundRequest.mediaUrls?.length
    ? outboundRequest.mediaUrls
    : undefined;
  const result: MessageSendResult = await sendMessage({
    cfg: params.ctx.cfg,
    to: outboundRequest.to,
    content: outboundRequest.text ?? "",
    agentId: params.ctx.agentId,
    requesterSessionKey: params.ctx.sessionKey,
    requesterAccountId: params.ctx.requesterAccountId ?? params.ctx.accountId ?? undefined,
    requesterSenderId: params.ctx.requesterSenderId,
    requesterSenderName: params.ctx.requesterSenderName,
    requesterSenderUsername: params.ctx.requesterSenderUsername,
    requesterSenderE164: params.ctx.requesterSenderE164,
    mediaUrl: (outboundMediaUrls?.[0] ?? params.mediaUrl) || undefined,
    mediaUrls: outboundMediaUrls,
    channel: outboundRequest.channel || undefined,
    accountId: outboundRequest.accountId ?? params.ctx.accountId ?? undefined,
    replyToId: outboundRequest.replyToId,
    threadId: outboundRequest.threadId,
    gifPlayback: params.gifPlayback,
    forceDocument: params.forceDocument,
    dryRun: params.ctx.dryRun,
    bestEffort: params.bestEffort ?? undefined,
    nativeGateway,
    deps: params.ctx.deps,
    gateway: params.ctx.gateway,
    mirror: params.ctx.mirror,
    abortSignal: params.ctx.abortSignal,
    silent: params.ctx.silent,
  });

  return {
    handledBy: "core",
    payload: result,
    sendResult: result,
  };
}

export async function executePollAction(params: {
  ctx: OutboundSendContext;
  resolveCorePoll: () => {
    to: string;
    question: string;
    options: string[];
    maxSelections: number;
    durationSeconds?: number;
    durationHours?: number;
    threadId?: string;
    isAnonymous?: boolean;
  };
}): Promise<{
  handledBy: "plugin" | "core";
  payload: unknown;
  toolResult?: AgentToolResult<unknown>;
  pollResult?: MessagePollResult;
}> {
  const nativeGateway = shouldUseNativeGatewayOutbound(params.ctx.channel);
  const pluginHandled = await tryHandleWithPluginAction({
    ctx: params.ctx,
    action: "poll",
  });
  if (pluginHandled) {
    return pluginHandled;
  }

  const corePoll = params.resolveCorePoll();
  const outboundRequest = await buildRustChannelOutboundRequest({
    requestId: `poll:${Date.now()}`,
    channel: params.ctx.channel,
    accountId: params.ctx.accountId ?? undefined,
    action: "poll",
    to: corePoll.to,
    text: corePoll.question,
    mediaUrls: [],
    threadId: corePoll.threadId,
    params: {
      question: corePoll.question,
      options: corePoll.options,
      maxSelections: corePoll.maxSelections,
      durationSeconds: corePoll.durationSeconds,
      durationHours: corePoll.durationHours,
      isAnonymous: corePoll.isAnonymous,
    },
  });
  const result: MessagePollResult = await sendPoll({
    cfg: params.ctx.cfg,
    to: outboundRequest.to,
    question: outboundRequest.text ?? corePoll.question,
    options: corePoll.options,
    maxSelections: corePoll.maxSelections,
    durationSeconds: corePoll.durationSeconds ?? undefined,
    durationHours: corePoll.durationHours ?? undefined,
    channel: outboundRequest.channel,
    accountId: outboundRequest.accountId ?? params.ctx.accountId ?? undefined,
    threadId: outboundRequest.threadId ?? corePoll.threadId ?? undefined,
    silent: params.ctx.silent ?? undefined,
    isAnonymous: corePoll.isAnonymous ?? undefined,
    dryRun: params.ctx.dryRun,
    nativeGateway,
    gateway: params.ctx.gateway,
  });

  return {
    handledBy: "core",
    payload: result,
    pollResult: result,
  };
}
