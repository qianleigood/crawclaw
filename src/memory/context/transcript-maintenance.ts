import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import {
  buildCompactedTranscriptMessage,
  isCompactedTranscriptMessage,
  shouldRewriteTranscriptMessage,
} from "./compaction.ts";

type RewriteTranscriptEntries = (request: {
  replacements: Array<{ entryId: string; message: AgentMessage }>;
}) => Promise<{
  changed: boolean;
  bytesFreed: number;
  rewrittenEntries: number;
  reason?: string;
}>;

export async function runTranscriptMaintenance(params: {
  runtimeStore: RuntimeStore;
  logger: { info(msg: string): void };
  sessionId: string;
  sessionFile: string;
  trigger?: string | null;
  rewriteTranscriptEntries?: RewriteTranscriptEntries;
}) {
  const { runtimeStore, logger, sessionId, sessionFile, trigger, rewriteTranscriptEntries } = params;
  if (typeof rewriteTranscriptEntries !== "function") {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "rewrite-unavailable",
    } as const;
  }

  const compactionState = await runtimeStore.getSessionCompactionState(sessionId);
  if (!compactionState || compactionState.preservedTailStartTurn <= 1) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "no-compaction-state",
    } as const;
  }

  const sessionManager = SessionManager.open(sessionFile);
  const branch = sessionManager.getBranch();
  let turnCounter = 0;
  const replacements: Array<{ entryId: string; message: AgentMessage }> = [];
  let skippedAlreadyCompacted = 0;
  let skippedShort = 0;

  for (const entry of branch) {
    if (entry.type !== "message") {continue;}
    turnCounter += 1;
    if (turnCounter >= compactionState.preservedTailStartTurn) {break;}
    const message = entry.message;
    if (isCompactedTranscriptMessage(message)) {
      skippedAlreadyCompacted += 1;
      continue;
    }
    if (!shouldRewriteTranscriptMessage(message)) {
      skippedShort += 1;
      continue;
    }
    replacements.push({
      entryId: entry.id,
      message: buildCompactedTranscriptMessage(message, turnCounter),
    });
  }

  if (!replacements.length) {
    logger.info(
      `[memory] transcript rewrite skipped sessionId=${sessionId} ` +
        `preservedTailStartTurn=${compactionState.preservedTailStartTurn} ` +
        `candidatePrefixMessages=${Math.max(0, turnCounter)} skippedAlreadyCompacted=${skippedAlreadyCompacted} skippedShort=${skippedShort} ` +
        `reason=no-transcript-replacements-needed`,
    );
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "no-transcript-replacements-needed",
    } as const;
  }

  const result = await rewriteTranscriptEntries({ replacements });
  await runtimeStore.appendCompactionAudit({
    sessionId,
    kind: "rewrite",
    trigger: trigger ?? null,
    reason: result.changed ? "transcript-rewrite" : (result.reason ?? "transcript-rewrite-noop"),
    preservedTailStartTurn: compactionState.preservedTailStartTurn,
    rewrittenEntries: result.rewrittenEntries,
    bytesFreed: result.bytesFreed,
    skippedAlreadyCompacted,
    skippedShort,
    detailsJson: JSON.stringify({
      candidatePrefixMessages: turnCounter,
      replacementsRequested: replacements.length,
      changed: result.changed,
      reason: result.reason ?? null,
    }),
  });
  if (result.changed) {
    logger.info(
      `[memory] transcript rewrite changed=${result.changed} rewritten=${result.rewrittenEntries} bytesFreed=${result.bytesFreed} ` +
        `preservedTailStartTurn=${compactionState.preservedTailStartTurn} candidatePrefixMessages=${turnCounter} ` +
        `skippedAlreadyCompacted=${skippedAlreadyCompacted} skippedShort=${skippedShort}`,
    );
  }
  return {
    ...result,
    replacements: replacements.map((entry) => ({
      entryId: entry.entryId,
      message: entry.message,
    })),
  };
}
