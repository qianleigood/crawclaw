import type { CompactPostArtifacts } from "../../agents/compaction/post-compact-artifacts.js";
import { resolveContextBudgetPolicyFromWindow } from "../../agents/context-window-guard.js";
import type { CompleteFn } from "../extraction/llm.ts";
import { estimateTokenCount } from "../recall/token-estimate.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { renderSessionSummaryForCompaction } from "../session-summary/sections.ts";
import { readSessionSummaryFile } from "../session-summary/store.ts";
import {
  getSessionSummarySectionText,
  inferSessionSummaryProfile,
} from "../session-summary/template.ts";
import type { GmMessageRow } from "../types/runtime.ts";
import {
  buildSessionSummaryPostCompactArtifacts,
  calculateCompactionBoundaryStartRow,
  estimateMessageRowTokens,
  MIN_COMPACTION_TAIL_MESSAGES,
} from "./compaction.ts";

const SESSION_SUMMARY_STALE_LEASE_MS = 60_000;
type CompactionSummarySource =
  | "session-summary"
  | "transcript-fallback-llm"
  | "transcript-fallback-local";

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

function normalizeCompactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const clean = text.trim();
  if (!clean || estimateTokenCount(clean) <= tokenBudget) {
    return clean;
  }
  let candidate = clean.slice(0, Math.max(1, tokenBudget * 4)).trimEnd();
  const suffix = "\n[truncated to fit compact summary budget]";
  while (candidate.length > 0 && estimateTokenCount(`${candidate}${suffix}`) > tokenBudget) {
    candidate = candidate.slice(0, Math.floor(candidate.length * 0.85)).trimEnd();
  }
  return candidate ? `${candidate}${suffix}` : clean.slice(0, 160).trimEnd();
}

function renderTranscriptFallbackRows(rows: GmMessageRow[]): string {
  const selectedRows = rows.length <= 16 ? rows : [...rows.slice(0, 4), ...rows.slice(-12)];
  const omittedRows = rows.length - selectedRows.length;
  const lines = selectedRows.map((row) => {
    const content = normalizeCompactText(row.contentText || row.content || "");
    const preview = content
      ? content.length > 500
        ? `${content.slice(0, 500).trimEnd()}...`
        : content
      : "[non-text message]";
    return `- turn ${row.turnIndex} ${row.role}: ${preview}`;
  });
  if (omittedRows > 0) {
    lines.splice(4, 0, `- ${omittedRows} middle message(s) omitted from fallback digest.`);
  }
  return lines.join("\n");
}

function buildLocalTranscriptFallbackSummary(params: {
  sessionId: string;
  summarizedRows: GmMessageRow[];
  tokenBudget: number;
}): string {
  const rows = params.summarizedRows;
  const firstTurn = rows[0]?.turnIndex ?? 0;
  const lastTurn = rows.at(-1)?.turnIndex ?? firstTurn;
  const summary = [
    "## Current State",
    "No session summary was available, so earlier transcript was compacted directly to keep the run within the model context window.",
    "",
    "## Compacted Transcript",
    `Session ${params.sessionId}: compacted ${rows.length} message(s) from turns ${firstTurn}-${lastTurn}.`,
    renderTranscriptFallbackRows(rows),
  ].join("\n");
  return truncateToTokenBudget(summary, params.tokenBudget);
}

async function buildTranscriptFallbackCompactionSummary(params: {
  sessionId: string;
  summarizedRows: GmMessageRow[];
  tokenBudget: number;
  complete?: CompleteFn;
  logger: { info(msg: string): void };
}): Promise<{ text: string; source: CompactionSummarySource }> {
  const localSummary = buildLocalTranscriptFallbackSummary({
    sessionId: params.sessionId,
    summarizedRows: params.summarizedRows,
    tokenBudget: params.tokenBudget,
  });
  if (!params.complete) {
    return { text: localSummary, source: "transcript-fallback-local" };
  }

  const transcriptDigest = truncateToTokenBudget(
    renderTranscriptFallbackRows(params.summarizedRows),
    Math.max(params.tokenBudget, 800),
  );
  try {
    const generated = await params.complete(
      [
        "You compact agent transcript history for future context.",
        "Preserve concrete facts, user requests, decisions, open work, errors, fixes, file paths, commands, identifiers, and constraints.",
        "Do not invent details. Return concise Markdown suitable for a compact_summary message.",
      ].join("\n"),
      [
        `Session ID: ${params.sessionId}`,
        `Compacted messages: ${params.summarizedRows.length}`,
        "",
        "The live tail after these messages remains visible separately. Summarize only this compacted prefix:",
        transcriptDigest,
      ].join("\n"),
    );
    const generatedText = generated.trim();
    if (generatedText) {
      const summary = /^##\s+/m.test(generatedText)
        ? generatedText
        : `## Current State\n${generatedText}`;
      return {
        text: truncateToTokenBudget(summary, params.tokenBudget),
        source: "transcript-fallback-llm",
      };
    }
  } catch (error) {
    params.logger.info(
      `[memory] transcript fallback summary generation failed sessionId=${params.sessionId} error=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return { text: localSummary, source: "transcript-fallback-local" };
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
}): Promise<{
  waitedForSummaryMs: number;
  timedOut: boolean;
  staleSummaryLeaseCleared: boolean;
}> {
  const startedAt = Date.now();
  const deadline = Date.now() + Math.max(0, params.maxWaitMs ?? 15_000);
  while (Date.now() < deadline) {
    const state = await params.runtimeStore.getSessionSummaryState(params.sessionId);
    if (!state?.summaryInProgress) {
      return {
        waitedForSummaryMs: Math.max(0, Date.now() - startedAt),
        timedOut: false,
        staleSummaryLeaseCleared: false,
      };
    }
    const leaseAgeMs = Math.max(0, Date.now() - state.updatedAt);
    if (leaseAgeMs >= SESSION_SUMMARY_STALE_LEASE_MS) {
      await params.runtimeStore.upsertSessionSummaryState({
        sessionId: state.sessionId,
        lastSummarizedMessageId: state.lastSummarizedMessageId,
        lastSummaryUpdatedAt: state.lastSummaryUpdatedAt,
        tokensAtLastSummary: state.tokensAtLastSummary,
        summaryInProgress: false,
      });
      return {
        waitedForSummaryMs: Math.max(0, Date.now() - startedAt),
        timedOut: false,
        staleSummaryLeaseCleared: true,
      };
    }
    await sleep(250);
  }
  return {
    waitedForSummaryMs: Math.max(0, Date.now() - startedAt),
    timedOut: true,
    staleSummaryLeaseCleared: false,
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
  complete?: CompleteFn;
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
  const budgetWindowTokens = Math.max(
    1,
    Math.floor(params.tokenBudget ?? params.currentTokenCount ?? 1000),
  );
  const contextBudgetPolicy = resolveContextBudgetPolicyFromWindow(budgetWindowTokens);
  const compactionPolicy = contextBudgetPolicy.compaction;
  const renderedSummary = renderSessionSummaryForCompaction(summaryFile.content, {
    tokenBudget: compactionPolicy.compactSummaryBudgetTokens,
  });
  const hasSessionSummary = renderedSummary.trim().length > 0;
  const summarizedThroughMessageId = summaryState?.lastSummarizedMessageId ?? null;
  const summaryLastUpdatedAt = summaryState?.lastSummaryUpdatedAt ?? summaryFile.updatedAt ?? null;
  const summaryAgeMs =
    summaryLastUpdatedAt != null ? Math.max(0, Date.now() - summaryLastUpdatedAt) : null;
  const summaryProfile = hasSessionSummary
    ? inferSessionSummaryProfile(summaryFile.document)
    : null;

  if (params.totalTurns < MIN_COMPACTION_TAIL_MESSAGES + 2) {
    params.logger.info(
      `[memory] compaction skipped sessionId=${params.sessionId} ${triggerInfo} reason=not-enough-turns totalTurns=${params.totalTurns}`,
    );
    return { ok: true, compacted: false, reason: "not-enough-turns" };
  }

  const minPreservedTokens = compactionPolicy.tailMinTokens;
  const maxPreservedTokens = compactionPolicy.tailMaxTokens;
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

  const compactionSummarizedThroughMessageId = hasSessionSummary
    ? summarizedThroughMessageId
    : null;
  const preservedTailStartRow = calculateCompactionBoundaryStartRow({
    rows: allRows,
    summarizedThroughMessageId: compactionSummarizedThroughMessageId,
    minTokens: minPreservedTokens,
    minTextMessages: compactionPolicy.minTextMessages,
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
    (existingState?.summarizedThroughMessageId ?? null) === compactionSummarizedThroughMessageId
  ) {
    params.logger.info(
      `[memory] compaction skipped sessionId=${params.sessionId} ${triggerInfo} reason=compaction-state-unchanged preservedTailStartTurn=${preservedTailStartTurn}`,
    );
    return { ok: true, compacted: false, reason: "compaction-state-unchanged" };
  }

  const keptRows = allRows.filter((row) => row.turnIndex >= preservedTailStartTurn);
  const summarizedRows = allRows.filter((row) => row.turnIndex < preservedTailStartTurn);
  const summaryBuild = hasSessionSummary
    ? ({
        text: renderedSummary,
        source: "session-summary",
      } satisfies { text: string; source: CompactionSummarySource })
    : await buildTranscriptFallbackCompactionSummary({
        sessionId: params.sessionId,
        summarizedRows,
        tokenBudget: compactionPolicy.compactSummaryBudgetTokens,
        complete: params.complete,
        logger: params.logger,
      });
  const compactSummaryText = summaryBuild.text;
  const compactionReason =
    summaryBuild.source === "session-summary"
      ? "session-summary-tail-compaction"
      : "transcript-fallback-tail-compaction";

  await params.runtimeStore.upsertSessionCompactionState({
    sessionId: params.sessionId,
    preservedTailStartTurn,
    preservedTailMessageId,
    summarizedThroughMessageId: compactionSummarizedThroughMessageId,
    mode: summaryBuild.source === "session-summary" ? "session-summary" : "transcript-fallback",
    summaryOverrideText: compactSummaryText,
  });

  const summaryTokens = estimateTokenCount(compactSummaryText);
  const tailTokensBefore = estimateMessageRowTokens(allRows);
  const tailTokensAfter = estimateMessageRowTokens(keptRows);
  const tokensBefore = Math.max(params.currentTokenCount ?? 0, summaryTokens + tailTokensBefore);
  const tokensAfter = summaryTokens + tailTokensAfter;
  const planAttachmentText = hasSessionSummary
    ? buildSessionSummaryPlanAttachmentText(summaryFile)
    : null;
  const postCompactArtifacts = buildSessionSummaryPostCompactArtifacts({
    summary: compactSummaryText,
    allRows,
    keptRows,
    planAttachmentText,
    trigger:
      typeof params.runtimeContext?.trigger === "string" ? params.runtimeContext.trigger : null,
    tokensBefore,
    messagesSummarized: summarizedRows.length,
    resumedWithoutBoundary: !compactionSummarizedThroughMessageId,
  });
  const compactionDetails = {
    trigger:
      typeof params.runtimeContext?.trigger === "string"
        ? params.runtimeContext.trigger
        : "unspecified",
    force: Boolean(params.force),
    resumedWithoutBoundary: !compactionSummarizedThroughMessageId,
    totalTurns: params.totalTurns,
    preservedTailStartTurn,
    preservedTailMessageId,
    summarizedThroughMessageId: compactionSummarizedThroughMessageId,
    summarizedMessages: summarizedRows.length,
    keptMessages: keptRows.length,
    summaryChars: compactSummaryText.length,
    summaryTokens,
    summaryProfile,
    summarySource: summaryBuild.source,
    summaryLastUpdatedAt,
    summaryAgeMs,
    waitedForSummaryMs: waitResult.waitedForSummaryMs,
    summaryWaitTimedOut: waitResult.timedOut,
    staleSummaryLeaseCleared: waitResult.staleSummaryLeaseCleared,
    planAttachmentIncluded: Boolean(planAttachmentText),
    tailTokensBefore,
    tailTokensAfter,
    minPreservedTokens,
    maxPreservedTokens,
    minTextMessages: compactionPolicy.minTextMessages,
    compactSummaryBudgetTokens: compactionPolicy.compactSummaryBudgetTokens,
  };
  await params.runtimeStore.appendCompactionAudit({
    sessionId: params.sessionId,
    kind: "compact",
    trigger:
      typeof params.runtimeContext?.trigger === "string" ? params.runtimeContext.trigger : null,
    reason: compactionReason,
    tokenBudget: params.tokenBudget ?? budgetWindowTokens,
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
    reason: compactionReason,
    result: {
      summary: compactSummaryText,
      firstKeptEntryId: preservedTailMessageId ?? "",
      tokensBefore,
      tokensAfter,
      postCompactArtifacts,
      details: compactionDetails,
    },
  };
}
