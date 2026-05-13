import { runCrawClawRuntimeTool } from "../agents/runtime-tools/native.js";
import type { TypingPolicy } from "../auto-reply/types.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";
import type { ResolveRunTypingPolicyParams, ResolvedRunTypingPolicy } from "./typing-policy.js";

const MESSAGE_POLICY_TOOL = "message_policy";
const MESSAGE_POLICY_TIMEOUT_MS = 30_000;

export async function resolveRunTypingPolicyWithRust(
  params: ResolveRunTypingPolicyParams,
): Promise<ResolvedRunTypingPolicy> {
  return await runCrawClawRuntimeTool<{
    typingPolicy: TypingPolicy;
    suppressTyping: boolean;
  }>(
    MESSAGE_POLICY_TOOL,
    {
      operation: "outbound.resolveTypingPolicy",
      payload: {
        requestedPolicy: params.requestedPolicy,
        suppressTyping: params.suppressTyping,
        isHeartbeat: params.isHeartbeat,
        originatingChannel: normalizeMessageChannel(params.originatingChannel),
        systemEvent: params.systemEvent,
      },
    },
    { timeoutMs: MESSAGE_POLICY_TIMEOUT_MS },
  );
}
