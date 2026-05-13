import { runCrawClawRuntimeTool } from "../../agents/runtime-tools/native.js";
import { normalizeMessageChannel } from "../../utils/message-channel.js";
import type { OriginatingChannelType } from "../templating.js";

const MESSAGE_POLICY_TOOL = "message_policy";
const MESSAGE_POLICY_TIMEOUT_MS = 30_000;

export type ReplyRoutingDecision = {
  originatingChannel?: string;
  currentSurface?: string;
  isInternalWebchatTurn: boolean;
  shouldRouteToOriginating: boolean;
  shouldSuppressTyping: boolean;
};

type RustReplyRoutingDecision = Omit<
  ReplyRoutingDecision,
  "originatingChannel" | "currentSurface"
> & {
  originatingChannel?: string | null;
  currentSurface?: string | null;
};

export async function resolveReplyRoutingDecisionWithRust(params: {
  provider?: string;
  surface?: string;
  explicitDeliverRoute?: boolean;
  originatingChannel?: string;
  originatingTo?: string;
  suppressDirectUserDelivery?: boolean;
  isRoutableChannel: (channel: OriginatingChannelType | undefined) => boolean;
}): Promise<ReplyRoutingDecision> {
  const originatingChannel = normalizeMessageChannel(params.originatingChannel);
  const provider = normalizeMessageChannel(params.provider);
  const surface = normalizeMessageChannel(params.surface);
  const result = await runCrawClawRuntimeTool<RustReplyRoutingDecision>(
    MESSAGE_POLICY_TOOL,
    {
      operation: "outbound.resolveReplyRoutingDecision",
      payload: {
        provider,
        surface,
        explicitDeliverRoute: params.explicitDeliverRoute,
        originatingChannel,
        originatingTo: params.originatingTo,
        suppressDirectUserDelivery: params.suppressDirectUserDelivery,
        originatingRoutable: params.isRoutableChannel(
          originatingChannel as OriginatingChannelType | undefined,
        ),
      },
    },
    { timeoutMs: MESSAGE_POLICY_TIMEOUT_MS },
  );
  return {
    ...result,
    originatingChannel: result.originatingChannel ?? undefined,
    currentSurface: result.currentSurface ?? undefined,
  };
}
