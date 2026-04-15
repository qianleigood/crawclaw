import {
  resolveCompatHookSessionKey,
  runAfterCompactionInternalHooks,
  runBeforeCompactionInternalHooks,
} from "./internal-hooks.js";
import type { CompactionHookRunner } from "./plugin-hooks.js";
import { runAfterCompactionPluginHooks, runBeforeCompactionPluginHooks } from "./plugin-hooks.js";
import { runPostCompactionSideEffects } from "./post-compaction.js";

export type { CompactionHookRunner } from "./plugin-hooks.js";

export async function runBeforeCompactionHooks(params: {
  hookRunner?: CompactionHookRunner | null;
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
  await runBeforeCompactionPluginHooks({
    hookRunner: params.hookRunner,
    sessionId: params.sessionId,
    sessionAgentId: params.sessionAgentId,
    hookSessionKey: hookState.hookSessionKey,
    workspaceDir: params.workspaceDir,
    messageProvider: params.messageProvider,
    sessionFile: params.sessionFile,
    messageCountBefore: params.metrics.messageCountBefore,
    tokenCountBefore: params.metrics.tokenCountBefore,
  });
  return hookState;
}

export async function runAfterCompactionHooks(params: {
  hookRunner?: CompactionHookRunner | null;
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
  await runAfterCompactionPluginHooks({
    hookRunner: params.hookRunner,
    sessionId: params.sessionId,
    sessionAgentId: params.sessionAgentId,
    hookSessionKey: params.hookSessionKey,
    workspaceDir: params.workspaceDir,
    messageProvider: params.messageProvider,
    messageCountAfter: params.messageCountAfter,
    tokensAfter: params.tokensAfter,
    compactedCount: params.compactedCount,
    sessionFile: params.sessionFile,
  });
}

export { resolveCompatHookSessionKey, runPostCompactionSideEffects };
