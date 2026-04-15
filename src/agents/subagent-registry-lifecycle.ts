import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { appendAssistantMessageToSessionTranscript } from "../config/sessions/transcript.js";
import { formatErrorMessage, readErrorName } from "../infra/errors.js";
import { parseAgentSessionKey } from "../routing/session-key.js";
import { defaultRuntime } from "../runtime.js";
import { emitSessionLifecycleEvent } from "../sessions/session-lifecycle-events.js";
import {
  completeTaskRunByRunId,
  failTaskRunByRunId,
  setDetachedTaskDeliveryStatusByRunId,
} from "../tasks/task-executor.js";
import type { TaskRuntime } from "../tasks/task-registry.types.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import { markAgentRunCompleted, markAgentRunFailed } from "./runtime/agent-progress.js";
import {
  captureSubagentCompletionReply,
  runSubagentAnnounceFlow,
  type SubagentRunOutcome,
} from "./subagent-announce.js";
import {
  SUBAGENT_ENDED_REASON_COMPLETE,
  type SubagentLifecycleEndedReason,
} from "./subagent-lifecycle-events.js";
import {
  resolveCleanupCompletionReason,
  resolveDeferredCleanupDecision,
} from "./subagent-registry-cleanup.js";
import { runOutcomesEqual } from "./subagent-registry-completion.js";
import {
  ANNOUNCE_COMPLETION_HARD_EXPIRY_MS,
  ANNOUNCE_EXPIRY_MS,
  capFrozenResultText,
  logAnnounceGiveUp,
  MAX_ANNOUNCE_RETRY_COUNT,
  MIN_ANNOUNCE_RETRY_DELAY_MS,
  persistSubagentSessionTiming,
  resolveAnnounceRetryDelayMs,
  safeRemoveAttachmentsDir,
} from "./subagent-registry-helpers.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

export function createSubagentRegistryLifecycleController(params: {
  runs: Map<string, SubagentRunRecord>;
  resumedRuns: Set<string>;
  subagentAnnounceTimeoutMs: number;
  persist(): void;
  clearPendingLifecycleError(runId: string): void;
  countPendingDescendantRuns(rootSessionKey: string): number;
  suppressAnnounceForSteerRestart(entry?: SubagentRunRecord): boolean;
  shouldEmitEndedHookForRun(args: {
    entry: SubagentRunRecord;
    reason: SubagentLifecycleEndedReason;
  }): boolean;
  emitSubagentEndedHookForRun(args: {
    entry: SubagentRunRecord;
    reason?: SubagentLifecycleEndedReason;
    sendFarewell?: boolean;
    accountId?: string;
  }): Promise<void>;
  emitSubagentLifecycleEvent(args: {
    phase: "subagent_start" | "subagent_stop";
    runId: string;
    entry: SubagentRunRecord;
    startedAt?: number;
    endedAt?: number;
    reason?: SubagentLifecycleEndedReason;
    outcome?: SubagentRunOutcome;
    error?: string;
  }): Promise<void>;
  notifyMemoryRuntimeSubagentEnded(args: {
    childSessionKey: string;
    reason: "completed" | "deleted";
    workspaceDir?: string;
  }): Promise<void>;
  resumeSubagentRun(runId: string): void;
  captureSubagentCompletionReply: typeof captureSubagentCompletionReply;
  runSubagentAnnounceFlow: typeof runSubagentAnnounceFlow;
  warn(message: string, meta?: Record<string, unknown>): void;
}) {
  const resolveTrackedTaskRuntime = (
    taskRuntime: TaskRuntime | null | undefined,
  ): Extract<TaskRuntime, "subagent" | "acp"> => (taskRuntime === "acp" ? "acp" : "subagent");

  const maskRunId = (runId: string): string => {
    const trimmed = runId.trim();
    if (!trimmed) {
      return "unknown";
    }
    if (trimmed.length <= 8) {
      return "***";
    }
    return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
  };

  const maskSessionKey = (sessionKey: string): string => {
    const trimmed = sessionKey.trim();
    if (!trimmed) {
      return "unknown";
    }
    const prefix = trimmed.split(":").slice(0, 2).join(":") || "session";
    return `${prefix}:…`;
  };

  const buildSafeLifecycleErrorMeta = (err: unknown): Record<string, string> => {
    const message = formatErrorMessage(err);
    const name = readErrorName(err);
    return name ? { name, message } : { message };
  };

  const buildSubagentOperatorMeta = (args: {
    runId: string;
    childSessionKey: string;
    decision: string;
    phase?: string;
    status?: string;
  }): Record<string, string> => {
    const parsed = parseAgentSessionKey(args.childSessionKey);
    return {
      runId: args.runId,
      sessionId: args.childSessionKey,
      ...(parsed?.agentId ? { agentId: parsed.agentId } : {}),
      traceId: `run-loop:${args.runId}`,
      spanId: `subagent:${args.runId}`,
      phase: args.phase ?? "subagent_stop",
      decision: args.decision,
      status: args.status ?? "error",
    };
  };

  const safeSetSubagentTaskDeliveryStatus = (args: {
    runId: string;
    childSessionKey: string;
    taskRuntime?: Extract<TaskRuntime, "subagent" | "acp">;
    deliveryStatus: "failed";
  }) => {
    try {
      setDetachedTaskDeliveryStatusByRunId({
        runId: args.runId,
        runtime: resolveTrackedTaskRuntime(args.taskRuntime),
        sessionKey: args.childSessionKey,
        deliveryStatus: args.deliveryStatus,
      });
    } catch (err) {
      params.warn("failed to update subagent background task delivery state", {
        ...buildSubagentOperatorMeta({
          runId: args.runId,
          childSessionKey: args.childSessionKey,
          decision: "subagent_delivery_status_update_failed",
        }),
        error: buildSafeLifecycleErrorMeta(err),
        maskedRunId: maskRunId(args.runId),
        maskedChildSessionKey: maskSessionKey(args.childSessionKey),
        deliveryStatus: args.deliveryStatus,
      });
    }
  };

  const safeFinalizeSubagentTaskRun = (args: {
    entry: SubagentRunRecord;
    outcome: SubagentRunOutcome;
  }) => {
    const endedAt = args.entry.endedAt ?? Date.now();
    const lastEventAt = endedAt;
    const progressSummary = args.entry.frozenResultText ?? undefined;
    try {
      if (args.outcome.status === "ok") {
        completeTaskRunByRunId({
          runId: args.entry.runId,
          runtime: resolveTrackedTaskRuntime(args.entry.taskRuntime),
          sessionKey: args.entry.childSessionKey,
          endedAt,
          lastEventAt,
          progressSummary,
          terminalSummary: null,
        });
        markAgentRunCompleted({
          runId: args.entry.runId,
          endedAt,
          summary: progressSummary ?? "Subagent completed",
        });
        return;
      }
      failTaskRunByRunId({
        runId: args.entry.runId,
        runtime: resolveTrackedTaskRuntime(args.entry.taskRuntime),
        sessionKey: args.entry.childSessionKey,
        status: args.outcome.status === "timeout" ? "timed_out" : "failed",
        endedAt,
        lastEventAt,
        error: args.outcome.status === "error" ? args.outcome.error : undefined,
        progressSummary,
        terminalSummary: null,
      });
      markAgentRunFailed({
        runId: args.entry.runId,
        endedAt,
        error:
          args.outcome.status === "error"
            ? args.outcome.error
            : args.outcome.status === "timeout"
              ? "Subagent timed out"
              : undefined,
        summary:
          args.outcome.status === "error"
            ? (args.outcome.error ?? "Subagent failed")
            : args.outcome.status === "timeout"
              ? "Subagent timed out"
              : "Subagent failed",
      });
    } catch (err) {
      params.warn("failed to finalize subagent background task state", {
        ...buildSubagentOperatorMeta({
          runId: args.entry.runId,
          childSessionKey: args.entry.childSessionKey,
          decision: "subagent_task_finalize_failed",
        }),
        error: buildSafeLifecycleErrorMeta(err),
        maskedRunId: maskRunId(args.entry.runId),
        maskedChildSessionKey: maskSessionKey(args.entry.childSessionKey),
        outcomeStatus: args.outcome.status,
      });
    }
  };

  const freezeRunResultAtCompletion = async (entry: SubagentRunRecord): Promise<boolean> => {
    if (entry.frozenResultText !== undefined) {
      return false;
    }
    try {
      const captured = await params.captureSubagentCompletionReply(entry.childSessionKey);
      entry.frozenResultText = captured?.trim() ? capFrozenResultText(captured) : null;
    } catch {
      entry.frozenResultText = null;
    }
    entry.frozenResultCapturedAt = Date.now();
    return true;
  };

  const materializeAcpWrapperTranscriptBestEffort = async (
    entry: SubagentRunRecord,
  ): Promise<boolean> => {
    if (entry.taskRuntime !== "acp") {
      return false;
    }
    const frozenResultText = entry.frozenResultText?.trim();
    if (!frozenResultText) {
      return false;
    }
    if (typeof entry.wrapperTranscriptMirroredAt === "number" || entry.wrapperTranscriptMirroring) {
      return false;
    }
    entry.wrapperTranscriptMirroring = true;
    const agentId = parseAgentSessionKey(entry.childSessionKey)?.agentId;
    try {
      const appended = await appendAssistantMessageToSessionTranscript({
        agentId,
        sessionKey: entry.childSessionKey,
        text: frozenResultText,
        idempotencyKey: `acp-wrapper-completion:${entry.runId}`,
      });
      if (!appended.ok) {
        params.warn("failed to materialize acp wrapper transcript", {
          ...buildSubagentOperatorMeta({
            runId: entry.runId,
            childSessionKey: entry.childSessionKey,
            decision: "subagent_wrapper_transcript_failed",
          }),
          maskedRunId: maskRunId(entry.runId),
          maskedChildSessionKey: maskSessionKey(entry.childSessionKey),
          reason: appended.reason,
        });
        return false;
      }
      entry.wrapperTranscriptMirroredAt = Date.now();
      return true;
    } finally {
      delete entry.wrapperTranscriptMirroring;
    }
  };

  const listPendingCompletionRunsForSession = (sessionKey: string): SubagentRunRecord[] => {
    const key = sessionKey.trim();
    if (!key) {
      return [];
    }
    const out: SubagentRunRecord[] = [];
    for (const entry of params.runs.values()) {
      if (entry.childSessionKey !== key) {
        continue;
      }
      if (entry.expectsCompletionMessage !== true) {
        continue;
      }
      if (typeof entry.endedAt !== "number") {
        continue;
      }
      if (typeof entry.cleanupCompletedAt === "number") {
        continue;
      }
      out.push(entry);
    }
    return out;
  };

  const refreshFrozenResultFromSession = async (sessionKey: string): Promise<boolean> => {
    const candidates = listPendingCompletionRunsForSession(sessionKey);
    if (candidates.length === 0) {
      return false;
    }

    let captured: string | undefined;
    try {
      captured = await captureSubagentCompletionReply(sessionKey);
    } catch {
      return false;
    }
    const trimmed = captured?.trim();
    if (!trimmed || isSilentReplyText(trimmed, SILENT_REPLY_TOKEN)) {
      return false;
    }

    const nextFrozen = capFrozenResultText(trimmed);
    const capturedAt = Date.now();
    let changed = false;
    for (const entry of candidates) {
      if (entry.frozenResultText === nextFrozen) {
        continue;
      }
      entry.frozenResultText = nextFrozen;
      entry.frozenResultCapturedAt = capturedAt;
      changed = true;
    }
    if (changed) {
      params.persist();
    }
    return changed;
  };

  const emitCompletionEndedHookIfNeeded = async (
    entry: SubagentRunRecord,
    reason: SubagentLifecycleEndedReason,
  ) => {
    if (
      entry.expectsCompletionMessage === true &&
      params.shouldEmitEndedHookForRun({
        entry,
        reason,
      })
    ) {
      await params.emitSubagentEndedHookForRun({
        entry,
        reason,
        sendFarewell: true,
      });
    }
  };

  const finalizeResumedAnnounceGiveUp = async (giveUpParams: {
    runId: string;
    entry: SubagentRunRecord;
    reason: "retry-limit" | "expiry";
  }) => {
    safeSetSubagentTaskDeliveryStatus({
      runId: giveUpParams.runId,
      childSessionKey: giveUpParams.entry.childSessionKey,
      taskRuntime: giveUpParams.entry.taskRuntime,
      deliveryStatus: "failed",
    });
    giveUpParams.entry.wakeOnDescendantSettle = undefined;
    giveUpParams.entry.fallbackFrozenResultText = undefined;
    giveUpParams.entry.fallbackFrozenResultCapturedAt = undefined;
    const shouldDeleteAttachments =
      giveUpParams.entry.cleanup === "delete" || !giveUpParams.entry.retainAttachmentsOnKeep;
    if (shouldDeleteAttachments) {
      await safeRemoveAttachmentsDir(giveUpParams.entry);
    }
    const completionReason = resolveCleanupCompletionReason(giveUpParams.entry);
    await emitCompletionEndedHookIfNeeded(giveUpParams.entry, completionReason);
    logAnnounceGiveUp(giveUpParams.entry, giveUpParams.reason);
    completeCleanupBookkeeping({
      runId: giveUpParams.runId,
      entry: giveUpParams.entry,
      cleanup: giveUpParams.entry.cleanup,
      completedAt: Date.now(),
    });
  };

  const beginSubagentCleanup = (runId: string) => {
    const entry = params.runs.get(runId);
    if (!entry) {
      return false;
    }
    if (entry.cleanupCompletedAt || entry.cleanupHandled) {
      return false;
    }
    entry.cleanupHandled = true;
    params.persist();
    return true;
  };

  const retryDeferredCompletedAnnounces = (excludeRunId?: string) => {
    const now = Date.now();
    for (const [runId, entry] of params.runs.entries()) {
      if (excludeRunId && runId === excludeRunId) {
        continue;
      }
      if (typeof entry.endedAt !== "number") {
        continue;
      }
      if (entry.cleanupCompletedAt || entry.cleanupHandled) {
        continue;
      }
      if (params.suppressAnnounceForSteerRestart(entry)) {
        continue;
      }
      const endedAgo = now - (entry.endedAt ?? now);
      if (entry.expectsCompletionMessage !== true && endedAgo > ANNOUNCE_EXPIRY_MS) {
        if (!beginSubagentCleanup(runId)) {
          continue;
        }
        void finalizeResumedAnnounceGiveUp({
          runId,
          entry,
          reason: "expiry",
        }).catch((error) => {
          defaultRuntime.log(
            `[warn] Subagent expiry finalize failed during deferred retry for run ${runId}: ${String(error)}`,
          );
          const current = params.runs.get(runId);
          if (!current || current.cleanupCompletedAt) {
            return;
          }
          current.cleanupHandled = false;
          params.persist();
        });
        continue;
      }
      params.resumedRuns.delete(runId);
      params.resumeSubagentRun(runId);
    }
  };

  const completeCleanupBookkeeping = (cleanupParams: {
    runId: string;
    entry: SubagentRunRecord;
    cleanup: "delete" | "keep";
    completedAt: number;
  }) => {
    if (cleanupParams.cleanup === "delete") {
      params.clearPendingLifecycleError(cleanupParams.runId);
      void params.notifyMemoryRuntimeSubagentEnded({
        childSessionKey: cleanupParams.entry.childSessionKey,
        reason: "deleted",
        workspaceDir: cleanupParams.entry.workspaceDir,
      });
      params.runs.delete(cleanupParams.runId);
      params.persist();
      retryDeferredCompletedAnnounces(cleanupParams.runId);
      return;
    }
    void params.notifyMemoryRuntimeSubagentEnded({
      childSessionKey: cleanupParams.entry.childSessionKey,
      reason: "completed",
      workspaceDir: cleanupParams.entry.workspaceDir,
    });
    cleanupParams.entry.cleanupCompletedAt = cleanupParams.completedAt;
    params.persist();
    retryDeferredCompletedAnnounces(cleanupParams.runId);
  };

  const finalizeSubagentCleanup = async (
    runId: string,
    cleanup: "delete" | "keep",
    didAnnounce: boolean,
  ) => {
    const entry = params.runs.get(runId);
    if (!entry) {
      return;
    }
    if (didAnnounce) {
      setDetachedTaskDeliveryStatusByRunId({
        runId,
        runtime: resolveTrackedTaskRuntime(entry.taskRuntime),
        sessionKey: entry.childSessionKey,
        deliveryStatus: "delivered",
      });
      entry.wakeOnDescendantSettle = undefined;
      entry.fallbackFrozenResultText = undefined;
      entry.fallbackFrozenResultCapturedAt = undefined;
      const completionReason = resolveCleanupCompletionReason(entry);
      await emitCompletionEndedHookIfNeeded(entry, completionReason);
      const shouldDeleteAttachments = cleanup === "delete" || !entry.retainAttachmentsOnKeep;
      if (shouldDeleteAttachments) {
        await safeRemoveAttachmentsDir(entry);
      }
      if (cleanup === "delete") {
        entry.frozenResultText = undefined;
        entry.frozenResultCapturedAt = undefined;
      }
      completeCleanupBookkeeping({
        runId,
        entry,
        cleanup,
        completedAt: Date.now(),
      });
      return;
    }

    const now = Date.now();
    const deferredDecision = resolveDeferredCleanupDecision({
      entry,
      now,
      activeDescendantRuns: Math.max(0, params.countPendingDescendantRuns(entry.childSessionKey)),
      announceExpiryMs: ANNOUNCE_EXPIRY_MS,
      announceCompletionHardExpiryMs: ANNOUNCE_COMPLETION_HARD_EXPIRY_MS,
      maxAnnounceRetryCount: MAX_ANNOUNCE_RETRY_COUNT,
      deferDescendantDelayMs: MIN_ANNOUNCE_RETRY_DELAY_MS,
      resolveAnnounceRetryDelayMs,
    });

    if (deferredDecision.kind === "defer-descendants") {
      entry.lastAnnounceRetryAt = now;
      entry.wakeOnDescendantSettle = true;
      entry.cleanupHandled = false;
      params.resumedRuns.delete(runId);
      params.persist();
      setTimeout(() => {
        params.resumeSubagentRun(runId);
      }, deferredDecision.delayMs).unref?.();
      return;
    }

    if (deferredDecision.retryCount != null) {
      entry.announceRetryCount = deferredDecision.retryCount;
      entry.lastAnnounceRetryAt = now;
    }

    if (deferredDecision.kind === "give-up") {
      setDetachedTaskDeliveryStatusByRunId({
        runId,
        runtime: resolveTrackedTaskRuntime(entry.taskRuntime),
        sessionKey: entry.childSessionKey,
        deliveryStatus: "failed",
      });
      entry.wakeOnDescendantSettle = undefined;
      entry.fallbackFrozenResultText = undefined;
      entry.fallbackFrozenResultCapturedAt = undefined;
      const shouldDeleteAttachments = cleanup === "delete" || !entry.retainAttachmentsOnKeep;
      if (shouldDeleteAttachments) {
        await safeRemoveAttachmentsDir(entry);
      }
      const completionReason = resolveCleanupCompletionReason(entry);
      await emitCompletionEndedHookIfNeeded(entry, completionReason);
      logAnnounceGiveUp(entry, deferredDecision.reason);
      completeCleanupBookkeeping({
        runId,
        entry,
        cleanup,
        completedAt: now,
      });
      return;
    }

    entry.cleanupHandled = false;
    params.resumedRuns.delete(runId);
    params.persist();
    if (deferredDecision.resumeDelayMs == null) {
      return;
    }
    setTimeout(() => {
      params.resumeSubagentRun(runId);
    }, deferredDecision.resumeDelayMs).unref?.();
  };

  const startSubagentAnnounceCleanupFlow = (runId: string, entry: SubagentRunRecord): boolean => {
    if (!beginSubagentCleanup(runId)) {
      return false;
    }
    const requesterOrigin = normalizeDeliveryContext(entry.requesterOrigin);
    const finalizeAnnounceCleanup = (didAnnounce: boolean) => {
      void finalizeSubagentCleanup(runId, entry.cleanup, didAnnounce).catch((err) => {
        defaultRuntime.log(`[warn] subagent cleanup finalize failed (${runId}): ${String(err)}`);
        const current = params.runs.get(runId);
        if (!current || current.cleanupCompletedAt) {
          return;
        }
        current.cleanupHandled = false;
        params.persist();
      });
    };

    void params
      .runSubagentAnnounceFlow({
        childSessionKey: entry.childSessionKey,
        childRunId: entry.runId,
        requesterSessionKey: entry.requesterSessionKey,
        requesterOrigin,
        requesterDisplayKey: entry.requesterDisplayKey,
        task: entry.task,
        timeoutMs: params.subagentAnnounceTimeoutMs,
        cleanup: entry.cleanup,
        roundOneReply: entry.frozenResultText ?? undefined,
        fallbackReply: entry.fallbackFrozenResultText ?? undefined,
        waitForCompletion: false,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        label: entry.label,
        outcome: entry.outcome,
        spawnMode: entry.spawnMode,
        expectsCompletionMessage: entry.expectsCompletionMessage,
        wakeOnDescendantSettle: entry.wakeOnDescendantSettle === true,
      })
      .then((didAnnounce) => {
        finalizeAnnounceCleanup(didAnnounce);
      })
      .catch((error) => {
        defaultRuntime.log(
          `[warn] Subagent announce flow failed during cleanup for run ${runId}: ${String(error)}`,
        );
        finalizeAnnounceCleanup(false);
      });
    return true;
  };

  const completeSubagentRun = async (completeParams: {
    runId: string;
    endedAt?: number;
    outcome: SubagentRunOutcome;
    reason: SubagentLifecycleEndedReason;
    sendFarewell?: boolean;
    accountId?: string;
    triggerCleanup: boolean;
  }) => {
    params.clearPendingLifecycleError(completeParams.runId);
    const entry = params.runs.get(completeParams.runId);
    if (!entry) {
      return;
    }

    let mutated = false;
    if (
      completeParams.reason === SUBAGENT_ENDED_REASON_COMPLETE &&
      entry.suppressAnnounceReason === "killed" &&
      (entry.cleanupHandled || typeof entry.cleanupCompletedAt === "number")
    ) {
      entry.suppressAnnounceReason = undefined;
      entry.cleanupHandled = false;
      entry.cleanupCompletedAt = undefined;
      mutated = true;
    }

    const endedAt =
      typeof completeParams.endedAt === "number" ? completeParams.endedAt : Date.now();
    if (entry.endedAt !== endedAt) {
      entry.endedAt = endedAt;
      mutated = true;
    }
    if (!runOutcomesEqual(entry.outcome, completeParams.outcome)) {
      entry.outcome = completeParams.outcome;
      mutated = true;
    }
    if (entry.endedReason !== completeParams.reason) {
      entry.endedReason = completeParams.reason;
      mutated = true;
    }

    if (await freezeRunResultAtCompletion(entry)) {
      mutated = true;
    }

    if (mutated) {
      params.persist();
    }
    if (await materializeAcpWrapperTranscriptBestEffort(entry)) {
      params.persist();
    }
    safeFinalizeSubagentTaskRun({
      entry,
      outcome: completeParams.outcome,
    });

    try {
      await persistSubagentSessionTiming(entry);
    } catch (err) {
      params.warn("failed to persist subagent session timing", {
        ...buildSubagentOperatorMeta({
          runId: entry.runId,
          childSessionKey: entry.childSessionKey,
          decision: "subagent_session_timing_persist_failed",
        }),
        err,
        runId: entry.runId,
        childSessionKey: entry.childSessionKey,
      });
    }

    if (mutated) {
      await params.emitSubagentLifecycleEvent({
        phase: "subagent_stop",
        runId: completeParams.runId,
        entry,
        endedAt,
        reason: completeParams.reason,
        outcome: completeParams.outcome,
        error: completeParams.outcome.status === "error" ? completeParams.outcome.error : undefined,
      });
    }

    const suppressedForSteerRestart = params.suppressAnnounceForSteerRestart(entry);
    if (mutated && !suppressedForSteerRestart) {
      emitSessionLifecycleEvent({
        sessionKey: entry.childSessionKey,
        reason: "subagent-status",
        parentSessionKey: entry.requesterSessionKey,
        label: entry.label,
      });
    }
    const shouldEmitEndedHook =
      !suppressedForSteerRestart &&
      params.shouldEmitEndedHookForRun({
        entry,
        reason: completeParams.reason,
      });
    const shouldDeferEndedHook =
      shouldEmitEndedHook &&
      completeParams.triggerCleanup &&
      entry.expectsCompletionMessage === true &&
      !suppressedForSteerRestart;
    if (!shouldDeferEndedHook && shouldEmitEndedHook) {
      await params.emitSubagentEndedHookForRun({
        entry,
        reason: completeParams.reason,
        sendFarewell: completeParams.sendFarewell,
        accountId: completeParams.accountId,
      });
    }

    if (!completeParams.triggerCleanup || suppressedForSteerRestart) {
      return;
    }
    startSubagentAnnounceCleanupFlow(completeParams.runId, entry);
  };

  return {
    completeCleanupBookkeeping,
    completeSubagentRun,
    finalizeResumedAnnounceGiveUp,
    refreshFrozenResultFromSession,
    startSubagentAnnounceCleanupFlow,
  };
}
