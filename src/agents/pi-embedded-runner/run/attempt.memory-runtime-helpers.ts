import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { resolveMemoryMessageChannel } from "../../../memory/engine/context-memory-runtime-helpers.ts";
import type { MemoryRuntime, MemoryRuntimeContext } from "../../../memory/index.js";
import { isSubagentSessionKey } from "../../../sessions/session-key-utils.ts";
import type { ContextBudgetPolicy } from "../../context-window-guard.js";
import { emitRunLoopLifecycleEvent } from "../../runtime/lifecycle/bus.js";
import { ensureSharedRunLoopLifecycleSubscribers } from "../../runtime/lifecycle/shared-subscribers.js";
import type { SpecialAgentParentForkContext } from "../../special/runtime/parent-fork-context.js";
import { extractToolCallsFromAssistant } from "../../tool-call-id.js";

export type AttemptMemoryRuntime = MemoryRuntime;

const NON_FINAL_ASSISTANT_STOP_REASONS = new Set([
  "tooluse",
  "tool_calls",
  "error",
  "aborted",
  "max_tokens",
  "length",
]);

function shouldEmitStopLifecyclePhase(
  messages: AgentMessage[],
  prePromptMessageCount: number,
): boolean {
  const newMessages = messages.slice(Math.max(0, prePromptMessageCount));
  const latestAssistant = newMessages
    .slice()
    .toReversed()
    .find((message) => message.role === "assistant");
  if (!latestAssistant) {
    return false;
  }
  if (extractToolCallsFromAssistant(latestAssistant as never).length > 0) {
    return false;
  }
  const stopReason =
    typeof (latestAssistant as { stopReason?: unknown }).stopReason === "string"
      ? String((latestAssistant as { stopReason?: unknown }).stopReason)
      : "";
  if (!stopReason) {
    return true;
  }
  const normalizedStopReason = stopReason.trim().toLowerCase();
  return !NON_FINAL_ASSISTANT_STOP_REASONS.has(normalizedStopReason);
}

export async function runAttemptMemoryRuntimeBootstrap(params: {
  hadSessionFile: boolean;
  memoryRuntime?: AttemptMemoryRuntime;
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  sessionManager: unknown;
  runtimeContext?: MemoryRuntimeContext;
  runMaintenance: (params: {
    memoryRuntime?: unknown;
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    reason: "bootstrap";
    sessionManager: unknown;
    runtimeContext?: MemoryRuntimeContext;
  }) => Promise<unknown>;
  warn: (message: string) => void;
}) {
  if (
    !params.hadSessionFile ||
    !(params.memoryRuntime?.bootstrap || params.memoryRuntime?.maintain)
  ) {
    return;
  }
  try {
    if (typeof params.memoryRuntime?.bootstrap === "function") {
      await params.memoryRuntime.bootstrap({
        sessionId: params.sessionId,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
      });
    }
    await params.runMaintenance({
      memoryRuntime: params.memoryRuntime,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      sessionFile: params.sessionFile,
      reason: "bootstrap",
      sessionManager: params.sessionManager,
      runtimeContext: params.runtimeContext,
    });
  } catch (bootstrapErr) {
    params.warn(`memory runtime bootstrap failed: ${String(bootstrapErr)}`);
  }
}

export async function assembleAttemptMemoryRuntime(params: {
  memoryRuntime?: AttemptMemoryRuntime;
  sessionId: string;
  sessionKey?: string;
  messages: AgentMessage[];
  tokenBudget?: number;
  modelId: string;
  prompt?: string;
  runtimeContext?: MemoryRuntimeContext;
}) {
  if (!params.memoryRuntime) {
    return undefined;
  }
  return await params.memoryRuntime.assemble({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    messages: params.messages,
    tokenBudget: params.tokenBudget,
    model: params.modelId,
    ...(params.prompt !== undefined ? { prompt: params.prompt } : {}),
    runtimeContext: params.runtimeContext,
  });
}

export async function finalizeAttemptMemoryRuntimeTurn(params: {
  memoryRuntime?: AttemptMemoryRuntime;
  runId?: string;
  promptError: boolean;
  aborted: boolean;
  yieldAborted: boolean;
  sessionIdUsed: string;
  sessionKey?: string;
  sessionFile: string;
  messagesSnapshot: AgentMessage[];
  parentForkContext?: SpecialAgentParentForkContext;
  prePromptMessageCount: number;
  tokenBudget?: number;
  contextBudgetPolicy?: ContextBudgetPolicy;
  runtimeContext?: MemoryRuntimeContext;
  runMaintenance: (params: {
    memoryRuntime?: unknown;
    sessionId: string;
    sessionKey?: string;
    sessionFile: string;
    reason: "turn";
    sessionManager: unknown;
    runtimeContext?: MemoryRuntimeContext;
  }) => Promise<unknown>;
  sessionManager: unknown;
  warn: (message: string) => void;
}) {
  if (!params.memoryRuntime) {
    return { postTurnFinalizationSucceeded: true };
  }

  let postTurnFinalizationSucceeded = true;
  const normalizedSessionKey =
    typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
  const isTopLevel = !normalizedSessionKey || !isSubagentSessionKey(normalizedSessionKey);
  const agentId =
    typeof params.runtimeContext?.agentId === "string" && params.runtimeContext.agentId.trim()
      ? params.runtimeContext.agentId
      : undefined;
  const messageChannel = resolveMemoryMessageChannel(params.runtimeContext);
  const senderId =
    typeof params.runtimeContext?.senderId === "string" && params.runtimeContext.senderId.trim()
      ? params.runtimeContext.senderId
      : undefined;
  const workspaceDir =
    typeof params.runtimeContext?.workspaceDir === "string" &&
    params.runtimeContext.workspaceDir.trim()
      ? params.runtimeContext.workspaceDir
      : undefined;
  ensureSharedRunLoopLifecycleSubscribers();

  if (typeof params.memoryRuntime.afterTurn === "function") {
    try {
      await params.memoryRuntime.afterTurn({
        sessionId: params.sessionIdUsed,
        sessionKey: params.sessionKey,
        sessionFile: params.sessionFile,
        messages: params.messagesSnapshot,
        prePromptMessageCount: params.prePromptMessageCount,
        tokenBudget: params.tokenBudget,
        runtimeContext: params.runtimeContext,
      });
    } catch (afterTurnErr) {
      postTurnFinalizationSucceeded = false;
      params.warn(`memory runtime afterTurn failed: ${String(afterTurnErr)}`);
    }
  } else {
    const newMessages = params.messagesSnapshot.slice(params.prePromptMessageCount);
    if (newMessages.length > 0) {
      if (typeof params.memoryRuntime.ingestBatch === "function") {
        try {
          await params.memoryRuntime.ingestBatch({
            sessionId: params.sessionIdUsed,
            sessionKey: params.sessionKey,
            messages: newMessages,
          });
        } catch (ingestErr) {
          postTurnFinalizationSucceeded = false;
          params.warn(`memory runtime ingest failed: ${String(ingestErr)}`);
        }
      } else {
        for (const msg of newMessages) {
          try {
            await params.memoryRuntime.ingest?.({
              sessionId: params.sessionIdUsed,
              sessionKey: params.sessionKey,
              message: msg,
            });
          } catch (ingestErr) {
            postTurnFinalizationSucceeded = false;
            params.warn(`memory runtime ingest failed: ${String(ingestErr)}`);
          }
        }
      }
    }
  }

  if (
    !params.promptError &&
    !params.aborted &&
    !params.yieldAborted &&
    postTurnFinalizationSucceeded
  ) {
    await emitRunLoopLifecycleEvent({
      phase: "post_sampling",
      ...(params.runId?.trim() ? { runId: params.runId.trim() } : {}),
      sessionId: params.sessionIdUsed,
      ...(normalizedSessionKey ? { sessionKey: normalizedSessionKey } : {}),
      ...(agentId ? { agentId } : {}),
      isTopLevel,
      sessionFile: params.sessionFile,
      turnIndex: params.messagesSnapshot.length,
      messageCount: params.messagesSnapshot.length,
      metadata: {
        prePromptMessageCount: params.prePromptMessageCount,
        ...(params.parentForkContext ? { parentForkContext: params.parentForkContext } : {}),
        ...(workspaceDir ? { workspaceDir } : {}),
        ...(messageChannel ? { messageChannel } : {}),
        ...(senderId ? { senderId } : {}),
        ...(params.contextBudgetPolicy ? { contextBudgetPolicy: params.contextBudgetPolicy } : {}),
      },
    });
  }

  if (
    !params.promptError &&
    !params.aborted &&
    !params.yieldAborted &&
    postTurnFinalizationSucceeded
  ) {
    await emitRunLoopLifecycleEvent({
      phase: "settled_turn",
      ...(params.runId?.trim() ? { runId: params.runId.trim() } : {}),
      sessionId: params.sessionIdUsed,
      ...(normalizedSessionKey ? { sessionKey: normalizedSessionKey } : {}),
      ...(agentId ? { agentId } : {}),
      isTopLevel,
      sessionFile: params.sessionFile,
      turnIndex: params.messagesSnapshot.length,
      messageCount: params.messagesSnapshot.length,
      metadata: {
        prePromptMessageCount: params.prePromptMessageCount,
        ...(params.parentForkContext ? { parentForkContext: params.parentForkContext } : {}),
        ...(workspaceDir ? { workspaceDir } : {}),
        ...(messageChannel ? { messageChannel } : {}),
        ...(senderId ? { senderId } : {}),
        ...(params.contextBudgetPolicy ? { contextBudgetPolicy: params.contextBudgetPolicy } : {}),
      },
    });
    if (shouldEmitStopLifecyclePhase(params.messagesSnapshot, params.prePromptMessageCount)) {
      await emitRunLoopLifecycleEvent({
        phase: "stop",
        ...(params.runId?.trim() ? { runId: params.runId.trim() } : {}),
        sessionId: params.sessionIdUsed,
        ...(normalizedSessionKey ? { sessionKey: normalizedSessionKey } : {}),
        ...(agentId ? { agentId } : {}),
        isTopLevel,
        sessionFile: params.sessionFile,
        turnIndex: params.messagesSnapshot.length,
        messageCount: params.messagesSnapshot.length,
        metadata: {
          prePromptMessageCount: params.prePromptMessageCount,
          ...(params.parentForkContext ? { parentForkContext: params.parentForkContext } : {}),
          ...(workspaceDir ? { workspaceDir } : {}),
          ...(messageChannel ? { messageChannel } : {}),
          ...(senderId ? { senderId } : {}),
          ...(params.contextBudgetPolicy
            ? { contextBudgetPolicy: params.contextBudgetPolicy }
            : {}),
        },
      });
    }
    await params.runMaintenance({
      memoryRuntime: params.memoryRuntime,
      sessionId: params.sessionIdUsed,
      sessionKey: params.sessionKey,
      sessionFile: params.sessionFile,
      reason: "turn",
      sessionManager: params.sessionManager,
      runtimeContext: params.runtimeContext,
    });
  } else {
    const stopFailureReason = params.promptError
      ? "prompt_error"
      : params.aborted
        ? "aborted"
        : params.yieldAborted
          ? "yield_aborted"
          : postTurnFinalizationSucceeded
            ? null
            : "after_turn_failed";
    if (stopFailureReason) {
      await emitRunLoopLifecycleEvent({
        phase: "stop_failure",
        ...(params.runId?.trim() ? { runId: params.runId.trim() } : {}),
        sessionId: params.sessionIdUsed,
        ...(normalizedSessionKey ? { sessionKey: normalizedSessionKey } : {}),
        ...(agentId ? { agentId } : {}),
        isTopLevel,
        sessionFile: params.sessionFile,
        turnIndex: params.messagesSnapshot.length,
        messageCount: params.messagesSnapshot.length,
        stopReason: stopFailureReason,
        error: stopFailureReason,
        metadata: {
          prePromptMessageCount: params.prePromptMessageCount,
          ...(params.parentForkContext ? { parentForkContext: params.parentForkContext } : {}),
          ...(workspaceDir ? { workspaceDir } : {}),
          ...(messageChannel ? { messageChannel } : {}),
          ...(senderId ? { senderId } : {}),
          ...(params.contextBudgetPolicy
            ? { contextBudgetPolicy: params.contextBudgetPolicy }
            : {}),
        },
      });
    }
  }

  return { postTurnFinalizationSucceeded };
}
