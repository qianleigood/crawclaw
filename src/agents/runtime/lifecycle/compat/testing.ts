import {
  resolveCompatHookSessionKey,
  runAfterCompactionInternalHooks,
  runBeforeCompactionInternalHooks,
} from "./internal-hooks.js";
import { runPostCompactionSideEffects } from "./post-compaction.js";

export async function runBeforeCompactionHooks(params: {
  sessionId: string;
  sessionKey?: string;
  sessionAgentId: string;
  workspaceDir: string;
  messageProvider?: string;
  sessionFile?: string;
  metrics: {
    messageCountOriginal: number;
    tokenCountOriginal?: number;
    messageCountBefore: number;
    tokenCountBefore?: number;
  };
}) {
  const hookState = await runBeforeCompactionInternalHooks({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    messageCountBefore: params.metrics.messageCountBefore,
    tokenCountBefore: params.metrics.tokenCountBefore,
    messageCountOriginal: params.metrics.messageCountOriginal,
    tokenCountOriginal: params.metrics.tokenCountOriginal,
  });
  return hookState;
}

export async function runAfterCompactionHooks(params: {
  sessionId: string;
  sessionAgentId: string;
  hookSessionKey: string;
  missingSessionKey: boolean;
  workspaceDir: string;
  messageProvider?: string;
  messageCountAfter: number;
  tokensAfter?: number;
  compactedCount: number;
  sessionFile: string;
  summaryLength?: number;
  tokensBefore?: number;
  firstKeptEntryId?: string;
  postCompactSummaryMessages?: number;
  postCompactKeptMessages?: number;
  postCompactAttachments?: number;
  postCompactDiscoveredTools?: number;
  postCompactHasPreservedSegment?: boolean;
}) {
  await runAfterCompactionInternalHooks({
    sessionId: params.sessionId,
    hookSessionKey: params.hookSessionKey,
    missingSessionKey: params.missingSessionKey,
    messageCountAfter: params.messageCountAfter,
    tokensAfter: params.tokensAfter,
    compactedCount: params.compactedCount,
    summaryLength: params.summaryLength,
    tokensBefore: params.tokensBefore,
    firstKeptEntryId: params.firstKeptEntryId,
    postCompactSummaryMessages: params.postCompactSummaryMessages,
    postCompactKeptMessages: params.postCompactKeptMessages,
    postCompactAttachments: params.postCompactAttachments,
    postCompactDiscoveredTools: params.postCompactDiscoveredTools,
    postCompactHasPreservedSegment: params.postCompactHasPreservedSegment,
  });
}

export { resolveCompatHookSessionKey, runPostCompactionSideEffects };
