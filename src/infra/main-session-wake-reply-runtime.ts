import { dispatchInboundWithRustAgent } from "../auto-reply/reply/agent-run-runtime.js";
import type { ReplyDispatcher, ReplyDispatchKind } from "../auto-reply/reply/reply-dispatcher.js";
import type { FinalizedMsgContext } from "../auto-reply/templating.js";
import type { GetReplyOptions, ReplyPayload } from "../auto-reply/types.js";
import type { CrawClawConfig } from "../config/config.js";

type MainSessionWakeReplyOptions = Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;

function createCapturingDispatcher(): {
  dispatcher: ReplyDispatcher;
  result: () => ReplyPayload | ReplyPayload[] | undefined;
} {
  const payloads: ReplyPayload[] = [];
  const queuedCounts: Record<ReplyDispatchKind, number> = {
    tool: 0,
    block: 0,
    final: 0,
  };
  const failedCounts: Record<ReplyDispatchKind, number> = {
    tool: 0,
    block: 0,
    final: 0,
  };

  const capture = (kind: ReplyDispatchKind, payload: ReplyPayload) => {
    queuedCounts[kind] += 1;
    payloads.push(payload);
    return true;
  };

  return {
    dispatcher: {
      sendToolResult: (payload) => capture("tool", payload),
      sendBlockReply: (payload) => capture("block", payload),
      sendFinalReply: (payload) => capture("final", payload),
      waitForIdle: async () => undefined,
      getQueuedCounts: () => ({ ...queuedCounts }),
      getFailedCounts: () => ({ ...failedCounts }),
      markComplete: () => undefined,
    },
    result: () => {
      if (payloads.length === 0) {
        return undefined;
      }
      return payloads.length === 1 ? payloads[0] : [...payloads];
    },
  };
}

export async function runMainSessionWakeReply(
  ctx: FinalizedMsgContext,
  replyOptions: MainSessionWakeReplyOptions,
  cfg: CrawClawConfig,
): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  const capture = createCapturingDispatcher();
  try {
    await dispatchInboundWithRustAgent({
      ctx,
      cfg,
      dispatcher: capture.dispatcher,
      replyOptions,
    });
    return capture.result();
  } finally {
    capture.dispatcher.markComplete();
    await capture.dispatcher.waitForIdle();
  }
}
