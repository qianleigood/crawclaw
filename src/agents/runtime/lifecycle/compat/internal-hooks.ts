import { createInternalHookEvent, triggerInternalHook } from "../../../../hooks/internal-hooks.js";
import { createSubsystemLogger } from "../../../../logging/subsystem.js";

const log = createSubsystemLogger("runtime-lifecycle-compat");

export function resolveCompatHookSessionKey(params: { sessionId: string; sessionKey?: string }): {
  hookSessionKey: string;
  missingSessionKey: boolean;
} {
  const missingSessionKey = !params.sessionKey || !params.sessionKey.trim();
  return {
    hookSessionKey: params.sessionKey?.trim() || params.sessionId,
    missingSessionKey,
  };
}

export async function runBeforeCompactionInternalHooks(params: {
  sessionId: string;
  sessionKey?: string;
  messageCountBefore: number;
  tokenCountBefore?: number;
  messageCountOriginal: number;
  tokenCountOriginal?: number;
}): Promise<{ hookSessionKey: string; missingSessionKey: boolean }> {
  const { hookSessionKey, missingSessionKey } = resolveCompatHookSessionKey({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
  });
  try {
    const hookEvent = createInternalHookEvent("session", "compact:before", hookSessionKey, {
      sessionId: params.sessionId,
      missingSessionKey,
      messageCount: params.messageCountBefore,
      tokenCount: params.tokenCountBefore,
      messageCountOriginal: params.messageCountOriginal,
      tokenCountOriginal: params.tokenCountOriginal,
    });
    await triggerInternalHook(hookEvent);
  } catch (err) {
    log.warn("session:compact:before hook failed", {
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
    });
  }
  return {
    hookSessionKey,
    missingSessionKey,
  };
}

export async function runAfterCompactionInternalHooks(params: {
  sessionId: string;
  hookSessionKey: string;
  missingSessionKey: boolean;
  messageCountAfter: number;
  tokensAfter?: number;
  compactedCount: number;
  summaryLength?: number;
  tokensBefore?: number;
  firstKeptEntryId?: string;
  postCompactSummaryMessages?: number;
  postCompactKeptMessages?: number;
  postCompactAttachments?: number;
  postCompactDiscoveredTools?: number;
  postCompactHasPreservedSegment?: boolean;
}): Promise<void> {
  try {
    const hookEvent = createInternalHookEvent("session", "compact:after", params.hookSessionKey, {
      sessionId: params.sessionId,
      missingSessionKey: params.missingSessionKey,
      messageCount: params.messageCountAfter,
      tokenCount: params.tokensAfter,
      compactedCount: params.compactedCount,
      summaryLength: params.summaryLength,
      tokensBefore: params.tokensBefore,
      tokensAfter: params.tokensAfter,
      firstKeptEntryId: params.firstKeptEntryId,
      postCompactSummaryMessages: params.postCompactSummaryMessages,
      postCompactKeptMessages: params.postCompactKeptMessages,
      postCompactAttachments: params.postCompactAttachments,
      postCompactDiscoveredTools: params.postCompactDiscoveredTools,
      postCompactHasPreservedSegment: params.postCompactHasPreservedSegment,
    });
    await triggerInternalHook(hookEvent);
  } catch (err) {
    log.warn("session:compact:after hook failed", {
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
    });
  }
}
