import type { AgentMessage } from "@mariozechner/pi-agent-core";

function estimateTokenCountSafe(
  messages: AgentMessage[],
  estimateTokensFn: (message: AgentMessage) => number,
): number | undefined {
  try {
    let total = 0;
    for (const message of messages) {
      total += estimateTokensFn(message);
    }
    return total;
  } catch {
    return undefined;
  }
}

export function buildBeforeCompactionHookMetrics(params: {
  originalMessages: AgentMessage[];
  currentMessages: AgentMessage[];
  observedTokenCount?: number;
  estimateTokensFn: (message: AgentMessage) => number;
}) {
  return {
    messageCountOriginal: params.originalMessages.length,
    tokenCountOriginal: estimateTokenCountSafe(params.originalMessages, params.estimateTokensFn),
    messageCountBefore: params.currentMessages.length,
    tokenCountBefore:
      params.observedTokenCount ??
      estimateTokenCountSafe(params.currentMessages, params.estimateTokensFn),
  };
}

export function estimateTokensAfterCompaction(params: {
  messagesAfter: AgentMessage[];
  observedTokenCount?: number;
  fullSessionTokensBefore: number;
  estimateTokensFn: (message: AgentMessage) => number;
}) {
  const tokensAfter = estimateTokenCountSafe(params.messagesAfter, params.estimateTokensFn);
  if (tokensAfter === undefined) {
    return undefined;
  }
  const sanityCheckBaseline = params.observedTokenCount ?? params.fullSessionTokensBefore;
  if (
    sanityCheckBaseline > 0 &&
    tokensAfter >
      (params.observedTokenCount !== undefined ? sanityCheckBaseline : sanityCheckBaseline * 1.1)
  ) {
    return undefined;
  }
  return tokensAfter;
}
