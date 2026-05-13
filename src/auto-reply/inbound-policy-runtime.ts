import { runCrawClawRuntimeTool } from "../agents/runtime-tools/native.js";
import type { FinalizeInboundContextOptions } from "../channels/inbound-context.js";
import type { FinalizedMsgContext, MsgContext } from "./templating.js";

const MESSAGE_POLICY_TOOL = "message_policy";
const MESSAGE_POLICY_TIMEOUT_MS = 30_000;

export async function finalizeInboundContextWithRust<T extends Record<string, unknown>>(
  ctx: T,
  opts: FinalizeInboundContextOptions = {},
): Promise<T & FinalizedMsgContext> {
  const result = await runCrawClawRuntimeTool<{ ctx: T & FinalizedMsgContext }>(
    MESSAGE_POLICY_TOOL,
    {
      operation: "inbound.finalizeContext",
      payload: { ctx, opts },
    },
    { timeoutMs: MESSAGE_POLICY_TIMEOUT_MS },
  );
  return result.ctx;
}

export type RustFinalizedMsgContext = MsgContext & FinalizedMsgContext;
