import type { CompactPostArtifacts } from "../../agents/compaction/post-compact-artifacts.js";
import { estimateTokenCount } from "../recall/token-estimate.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { renderSessionSummaryForCompaction } from "../session-summary/sections.ts";
import { readSessionSummaryFile } from "../session-summary/store.ts";
import {
  getSessionSummarySectionText,
  inferSessionSummaryProfile,
} from "../session-summary/template.ts";
import {
  buildSessionSummaryPostCompactArtifacts,
  calculateCompactionBoundaryStartRow,
  estimateMessageRowTokens,
  MIN_COMPACTION_TAIL_MESSAGES,
  MIN_COMPACTION_TEXT_MESSAGES,
} from "./compaction.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSessionSummaryPlanAttachmentText(
  summaryFile: Awaited<ReturnType<typeof readSessionSummaryFile>>,
): string | null {
  const document = summaryFile.document;
  if (!document) {
    return null;
  }

  const parts = [
    { label: "Current State", text: getSessionSummarySectionText(document, "currentState") },
    { label: "Open Loops", text: getSessionSummarySectionText(document, "openLoops") },
    {
      label: "Task Specification",
      text: getSessionSummarySectionText(document, "taskSpecification"),
    },
    { label: "Workflow", text: getSessionSummarySectionText(document, "workflow") },
  ].filter((entry) => entry.text.trim().length > 0);

  if (!parts.length) {
    return null;
  }
  return parts.map((entry) => `## ${entry.label}\n${entry.text.trim()}`).join("\n\n");
}

export function formatCompactionTrigger(
  runtimeContext: Record<string, unknown> | undefined,
): string {
  const trigger =
    typeof runtimeContext?.trigger === "string" ? runtimeContext.trigger : "unspecified";
  const diagId = typeof runtimeContext?.diagId === "string" ? runtimeContext.diagId : null;
  const attempt = typeof runtimeContext?.attempt === "number" ? runtimeContext.attempt : null;
  const maxAttempts =
    typeof runtimeContext?.maxAttempts === "number" ? runtimeContext.maxAttempts : null;
  return [
    `trigger=${trigger}`,
    ...(diagId ? [`diagId=${diagId}`] : []),
    ...(attempt != null && maxAttempts != null ? [`attempt=${attempt}/${maxAttempts}`] : []),
  ].join(" ");
}

async function waitForSessionSummaryIdle(params: {
  runtimeStore: RuntimeStore;
  sessionId: string;
  maxWaitMs?: number;
}): Promise<{ waitedForSummaryMs: number; timedOut: boolean }> {
  const startedAt = Date.now();
  const deadline = Date.now() + Math.max(0, params.maxWaitMs ?? 15_000);
  while (Date.now() < deadline) {
    const state = await params.runtimeStore.getSessionSummaryState(params.sessionId);
    if (!state?.summaryInProgress) {
      return {
        waitedForSummaryMs: Math.max(0, Date.now() - startedAt),
        timedOut: false,
      };
    }
    await sleep(250);
  }
  return {
    waitedForSummaryMs: Math.max(0, Date.now() - startedAt),
    timedOut: true,
  };
}

type CompactionResult =
  | { ok: true; compacted: false; reason: string }
  | {
      ok: true;
      compacted: true;
      reason: string;
      result: {
        summary: string;
        firstKeptEntryId: string;
        tokensBefore: number;
        tokensAfter: number;
        postCompactArtifacts: CompactPostArtifacts;
        details: Record<string, unknown>;
      };
    };

export async function runSessionMemoryCompaction(params: {
  runtimeStore: RuntimeStore;
  logger: { info(msg: string): void };
  sessionId: string;
  agentId: string;
  totalTurns: number;
  tokenBudget?: number;
  currentTokenCount?: number;
  force?: boolean;
  runtimeContext?: Record<string, unknown>;
  maxSummaryWaitMs?: number;
}): Promise<CompactionResult> {
  const triggerInfo = formatCompactionTrigger(params.runtimeContext);
  const waitResult = await waitForSessionSummaryIdle({
    runtimeStore: params.runtimeStore,
    sessionId: params.sessionId,
    maxWaitMs: params.maxSummaryWaitMs,
  });

  const [summaryFile, summaryState] = await Promise.all([
    readSessionSummaryFile({
      agentId: params.agentId,
      sessionId: params.sessionId,
    }),
    params.runtimeStore.getSessionSummaryState(params.sessionId),
  ]);
  const renderedSummary = renderSessionSummaryForCompaction(summaryFile.content);
  const summarizedThroughMessageId = summaryState?.lastSummarizedMessageId ?? null;
  const summaryLastUpdatedAt = summaryState?.lastSummaryUpdatedAt ?? summaryFile.updatedAt ?? null;
  const summaryAgeMs =
    summaryLastUpdatedAt != null ? Math.max(0, Date.now() - summaryLastUpdatedAt) : null;
  const summaryProfile = inferSessionSummaryProfile(summaryFile.document);

  if (!renderedSummary.trim()) {
    params.logger.info(
      `[memory] compaction skipped sessionId=${params.sessionId} ${triggerInfo} reason=session-summary-unavailable`,
    );
    return { ok: true, compacted: false, reason: "session-summary-unavailable" };
  }

  if (params.totalTurns < MIN_COMPACTION_TAIL_MESSAGES + 2) {
    params.logger.info(
      `[memory] compaction skipped sessionId=${params.sessionId} ${triggerInfo} reason=not-enough-turns totalTurns=${params.totalTurns}`,
    );
    return { ok: true, compacted: false, reason: "not-enough-turns" };
  }

  const effectiveBudget = Math.max(
    240,
    Math.min(params.tokenBudget ?? params.currentTokenCount ?? 1000, 1200),
  );
  const minPreservedTokens = Math.max(120, Math.min(420, Math.floor(effectiveBudget * 0.35)));
  const maxPreservedTokens = Math.max(
    minPreservedTokens,
    Math.min(840, Math.floor(effectiveBudget * 0.75)),
  );
  const allRows = await params.runtimeStore.listMessagesByTurnRange(
    params.sessionId,
    1,
    params.totalTurns,
  );
  const existingState = await params.runtimeStore.getSessionCompactionState(params.sessionId);
  if (allRows.length <= MIN_COMPACTION_TAIL_MESSAGES) {
    params.logger.info(
      `[memory] compaction skipped sessionId=${params.sessionId} ${triggerInfo} reason=tail-already-small tailMessages=${allRows.length}`,
    );
    return { ok: true, compacted: false, reason: "tail-already-small" };
  }

  const preservedTailStartRow = calculateCompactionBoundaryStartRow({
    rows: allRows,
    summarizedThroughMessageId,
    minTokens: minPreservedTokens,
    minTextMessages: MIN_COMPACTION_TEXT_MESSAGES,
    maxTokens: maxPreservedTokens,
    floorMessageId: existingState?.preservedTailMessageId ?? null,
    floorTurnIndex: existingState?.preservedTailStartTurn ?? null,
  });
  if (!preservedTailStartRow) {
    params.logger.info(
      `[memory] compaction skipped sessionId=${params.sessionId} ${triggerInfo} reason=summarized-boundary-missing`,
    );
    return { ok: true, compacted: false, reason: "summarized-boundary-missing" };
  }
  const preservedTailStartTurn = preservedTailStartRow?.turnIndex ?? 1;
  const preservedTailMessageId = preservedTailStartRow?.id ?? null;
  if (preservedTailStartTurn <= 1) {
    params.logger.info(
      `[memory] compaction skipped sessionId=${params.sessionId} ${triggerInfo} reason=compaction-would-keep-full-history totalTurns=${params.totalTurns}`,
    );
    return { ok: true, compacted: false, reason: "compaction-would-keep-full-history" };
  }

  if (
    !params.force &&
    existingState?.preservedTailStartTurn === preservedTailStartTurn &&
    (existingState?.preservedTailMessageId ?? null) === preservedTailMessageId &&
    (existingState?.summarizedThroughMessageId ?? null) === summarizedThroughMessageId
  ) {
    params.logger.info(
      `[memory] compaction skipped sessionId=${params.sessionId} ${triggerInfo} reason=compaction-state-unchanged preservedTailStartTurn=${preservedTailStartTurn}`,
    );
    return { ok: true, compacted: false, reason: "compaction-state-unchanged" };
  }

  await params.runtimeStore.upsertSessionCompactionState({
    sessionId: params.sessionId,
    preservedTailStartTurn,
    preservedTailMessageId,
    summarizedThroughMessageId,
    mode: "session-summary",
    summaryOverrideText: null,
  });

  const keptRows = allRows.filter((row) => row.turnIndex >= preservedTailStartTurn);
  const summarizedRows = allRows.filter((row) => row.turnIndex < preservedTailStartTurn);
  const summaryTokens = estimateTokenCount(renderedSummary);
  const tailTokensBefore = estimateMessageRowTokens(allRows);
  const tailTokensAfter = estimateMessageRowTokens(keptRows);
  const tokensBefore = Math.max(params.currentTokenCount ?? 0, summaryTokens + tailTokensBefore);
  const tokensAfter = summaryTokens + tailTokensAfter;
  const planAttachmentText = buildSessionSummaryPlanAttachmentText(summaryFile);
  const postCompactArtifacts = buildSessionSummaryPostCompactArtifacts({
    summary: renderedSummary,
    allRows,
    keptRows,
    planAttachmentText,
    trigger:
      typeof params.runtimeContext?.trigger === "string" ? params.runtimeContext.trigger : null,
    tokensBefore,
    messagesSummarized: summarizedRows.length,
    resumedWithoutBoundary: !summarizedThroughMessageId,
  });
  const compactionDetails = {
    trigger:
      typeof params.runtimeContext?.trigger === "string"
        ? params.runtimeContext.trigger
        : "unspecified",
    force: Boolean(params.force),
    resumedWithoutBoundary: !summarizedThroughMessageId,
    totalTurns: params.totalTurns,
    preservedTailStartTurn,
    preservedTailMessageId,
    summarizedThroughMessageId,
    summarizedMessages: summarizedRows.length,
    keptMessages: keptRows.length,
    summaryChars: renderedSummary.length,
    summaryTokens,
    summaryProfile,
    summaryLastUpdatedAt,
    summaryAgeMs,
    waitedForSummaryMs: waitResult.waitedForSummaryMs,
    summaryWaitTimedOut: waitResult.timedOut,
    planAttachmentIncluded: Boolean(planAttachmentText),
    tailTokensBefore,
    tailTokensAfter,
    minPreservedTokens,
    maxPreservedTokens,
  };
  await params.runtimeStore.appendCompactionAudit({
    sessionId: params.sessionId,
    kind: "compact",
    trigger:
      typeof params.runtimeContext?.trigger === "string" ? params.runtimeContext.trigger : null,
    reason: "session-summary-tail-compaction",
    tokenBudget: params.tokenBudget ?? effectiveBudget,
    currentTokenCount: params.currentTokenCount ?? null,
    tokensBefore,
    tokensAfter,
    preservedTailStartTurn,
    summarizedMessages: summarizedRows.length,
    keptMessages: keptRows.length,
    detailsJson: JSON.stringify(compactionDetails),
  });
  params.logger.info(
    `[memory] compaction success sessionId=${params.sessionId} ${triggerInfo} force=${Boolean(params.force)} summarizedMessages=${summarizedRows.length} keptMessages=${keptRows.length} preservedTailStartTurn=${preservedTailStartTurn} tokens=${tokensBefore}->${tokensAfter} summaryTokens=${summaryTokens} tailTokens=${tailTokensBefore}->${tailTokensAfter}`,
  );

  return {
    ok: true,
    compacted: true,
    reason: "session-summary-tail-compaction",
    result: {
      summary: renderedSummary,
      firstKeptEntryId: preservedTailMessageId ?? "",
      tokensBefore,
      tokensAfter,
      postCompactArtifacts,
      details: compactionDetails,
    },
  };
}
