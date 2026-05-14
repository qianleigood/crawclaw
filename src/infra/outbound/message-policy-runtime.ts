import { runCrawClawRuntimeTool } from "../../agents/runtime-tools/native.js";
import type {
  ChannelId,
  ChannelMessageActionName,
  ChannelThreadingToolContext,
} from "../../channels/plugins/types.js";
import type { CrawClawConfig } from "../../config/config.js";
import type {
  OutboundSessionRoute,
  ResolveOutboundSessionRouteParams,
} from "./outbound-session.js";

const MESSAGE_POLICY_TOOL = "message_policy";
const MESSAGE_POLICY_TIMEOUT_MS = 30_000;

const CONTEXT_GUARDED_ACTIONS = new Set<ChannelMessageActionName>([
  "send",
  "poll",
  "reply",
  "sendWithEffect",
  "sendAttachment",
  "upload-file",
  "thread-create",
  "thread-reply",
  "sticker",
]);

type MessagePolicyOptions = {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

export type RustChannelOutboundRequest = {
  requestId: string;
  channel: ChannelId;
  accountId?: string;
  action: string;
  to: string;
  text?: string;
  mediaUrls?: string[];
  replyToId?: string;
  threadId?: string;
  params?: Record<string, unknown>;
};

export type RustOutboundTransportPolicy = {
  channel?: ChannelId;
  isBundledChannel?: boolean;
  allowTsChannelRuntime?: boolean;
  runtime: "rustNative" | "tsPluginCompat";
  useNativeGateway: boolean;
};

export type RustOutboundTransportPolicyRequest = {
  channel: ChannelId;
  bundledChannels: string[];
  allowTsChannelRuntime: boolean;
};

async function runMessagePolicyOperation<T>(
  operation: string,
  payload: unknown,
  options: MessagePolicyOptions = {},
): Promise<T> {
  return await runCrawClawRuntimeTool<T>(
    MESSAGE_POLICY_TOOL,
    { operation, payload },
    {
      env: options.env,
      timeoutMs: options.timeoutMs ?? MESSAGE_POLICY_TIMEOUT_MS,
    },
  );
}

export async function buildRustChannelOutboundRequest(
  request: RustChannelOutboundRequest,
): Promise<RustChannelOutboundRequest> {
  const result = await runMessagePolicyOperation<{ request: RustChannelOutboundRequest }>(
    "outbound.buildDeliveryRequest",
    request,
  );
  return result.request;
}

export async function resolveRustOutboundTransportPolicy(
  request: RustOutboundTransportPolicyRequest,
): Promise<RustOutboundTransportPolicy> {
  return await runMessagePolicyOperation<RustOutboundTransportPolicy>(
    "outbound.resolveTransportPolicy",
    request,
  );
}

function contextGuardTarget(
  action: ChannelMessageActionName,
  args: Record<string, unknown>,
): string | undefined {
  if (!CONTEXT_GUARDED_ACTIONS.has(action)) {
    return undefined;
  }
  if (action === "thread-reply" || action === "thread-create") {
    if (typeof args.channelId === "string") {
      return args.channelId;
    }
    if (typeof args.to === "string") {
      return args.to;
    }
    return undefined;
  }
  if (typeof args.to === "string") {
    return args.to;
  }
  if (typeof args.channelId === "string") {
    return args.channelId;
  }
  return undefined;
}

function shouldAskRustCrossContextPolicy(params: {
  channel: ChannelId;
  action: ChannelMessageActionName;
  args: Record<string, unknown>;
  toolContext?: ChannelThreadingToolContext;
  cfg: CrawClawConfig;
}): boolean {
  const currentTarget = params.toolContext?.currentChannelId?.trim();
  if (!currentTarget || !CONTEXT_GUARDED_ACTIONS.has(params.action)) {
    return false;
  }
  if (params.cfg.tools?.message?.allowCrossContextSend) {
    return false;
  }

  const currentProvider = params.toolContext?.currentChannelProvider;
  if (currentProvider && currentProvider !== params.channel) {
    return true;
  }

  const allowWithinProvider =
    params.cfg.tools?.message?.crossContext?.allowWithinProvider !== false;
  if (allowWithinProvider) {
    return false;
  }
  return contextGuardTarget(params.action, params.args) !== undefined;
}

export async function enforceRustCrossContextPolicy(params: {
  channel: ChannelId;
  action: ChannelMessageActionName;
  args: Record<string, unknown>;
  toolContext?: ChannelThreadingToolContext;
  cfg: CrawClawConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  if (!shouldAskRustCrossContextPolicy(params)) {
    return;
  }
  await runMessagePolicyOperation(
    "outbound.enforceCrossContextPolicy",
    {
      cfg: params.cfg,
      channel: params.channel,
      action: params.action,
      args: params.args,
      toolContext: params.toolContext,
    },
    { env: params.env },
  );
}

export async function resolveRustOutboundFallbackSessionRoute(
  params: ResolveOutboundSessionRouteParams,
): Promise<OutboundSessionRoute | null> {
  const result = await runMessagePolicyOperation<{ route: OutboundSessionRoute | null }>(
    "outbound.resolveFallbackSessionRoute",
    {
      cfg: params.cfg,
      channel: params.channel,
      agentId: params.agentId,
      accountId: params.accountId,
      target: params.target,
      resolvedTarget: params.resolvedTarget,
      replyToId: params.replyToId,
      threadId: params.threadId,
    },
  );
  return result.route;
}
