import { emitSessionTranscriptUpdate } from "../sessions/transcript-events.js";
import type { AgentMessage } from "./agent-types.js";
import {
  HARD_MAX_TOOL_RESULT_CHARS,
  truncateToolResultMessage,
} from "./runtime-support/tool-result-truncation.js";
import { createPendingToolCallState } from "./session-tool-result-state.js";
import { makeMissingToolResult, sanitizeToolCallInputs } from "./session-transcript-repair.js";
import { extractToolCallsFromAssistant, extractToolResultId } from "./tool-call-id.js";

const GUARD_TRUNCATION_SUFFIX =
  "\n\n⚠️ [Content truncated during persistence — original exceeded size limit. " +
  "Use offset/limit parameters or request specific sections for large content.]";
const RAW_APPEND_MESSAGE = Symbol("crawclaw.session.rawAppendMessage");

export type SessionManagerLike = {
  appendMessage: (message: never) => string | undefined | void;
  getEntries: () => Array<{ type: string; message?: unknown }>;
  getSessionFile?: () => string | null | undefined;
};

type SessionManagerWithRawAppend<T extends SessionManagerLike = SessionManagerLike> = T & {
  [RAW_APPEND_MESSAGE]?: T["appendMessage"];
};

/**
 * Truncate oversized text content blocks in a tool result message.
 * Returns the original message if under the limit, or a new message with
 * truncated text blocks otherwise.
 */
function capToolResultSize(msg: AgentMessage): AgentMessage {
  if ((msg as { role?: string }).role !== "toolResult") {
    return msg;
  }
  return truncateToolResultMessage(msg, HARD_MAX_TOOL_RESULT_CHARS, {
    suffix: GUARD_TRUNCATION_SUFFIX,
    minKeepChars: 2_000,
  });
}

function trimNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizePersistedToolResultName(
  message: AgentMessage,
  fallbackName?: string,
): AgentMessage {
  if ((message as { role?: unknown }).role !== "toolResult") {
    return message;
  }
  const toolResult = message as Extract<AgentMessage, { role: "toolResult" }>;
  const rawToolName = (toolResult as { toolName?: unknown }).toolName;
  const normalizedToolName = trimNonEmptyString(rawToolName);
  if (normalizedToolName) {
    if (rawToolName === normalizedToolName) {
      return toolResult;
    }
    return { ...toolResult, toolName: normalizedToolName };
  }

  const normalizedFallback = trimNonEmptyString(fallbackName);
  if (normalizedFallback) {
    return { ...toolResult, toolName: normalizedFallback };
  }

  if (typeof rawToolName === "string") {
    return { ...toolResult, toolName: "unknown" };
  }
  return toolResult;
}

/**
 * Return the unguarded appendMessage implementation for a session manager.
 */
export function getRawSessionAppendMessage<T extends SessionManagerLike>(
  sessionManager: T,
): T["appendMessage"] {
  const rawAppend = (sessionManager as SessionManagerWithRawAppend<T>)[RAW_APPEND_MESSAGE];
  return rawAppend ?? (sessionManager.appendMessage.bind(sessionManager) as T["appendMessage"]);
}

export function installSessionToolResultGuard<T extends SessionManagerLike>(
  sessionManager: T,
  opts?: {
    /** Optional session key for transcript update broadcasts. */
    sessionKey?: string;
    /**
     * Optional transform applied to any message before persistence.
     */
    transformMessageForPersistence?: (message: AgentMessage) => AgentMessage;
    /**
     * Whether to synthesize missing tool results to satisfy strict providers.
     * Defaults to true.
     */
    allowSyntheticToolResults?: boolean;
    /**
     * Optional set/list of tool names accepted for assistant toolCall/toolUse blocks.
     * When set, tool calls with unknown names are dropped before persistence.
     */
    allowedToolNames?: Iterable<string>;
  },
): {
  flushPendingToolResults: () => void;
  clearPendingToolResults: () => void;
  getPendingIds: () => string[];
} {
  const originalAppend = getRawSessionAppendMessage(sessionManager);
  (sessionManager as SessionManagerWithRawAppend<T>)[RAW_APPEND_MESSAGE] = originalAppend;
  const pendingState = createPendingToolCallState();
  const persistMessage = (message: AgentMessage) => {
    const transformer = opts?.transformMessageForPersistence;
    return transformer ? transformer(message) : message;
  };

  const allowSyntheticToolResults = opts?.allowSyntheticToolResults ?? true;
  const appendAndEmitTranscriptUpdate = (message: AgentMessage) => {
    const result = originalAppend(message as never);
    const sessionFile = (
      sessionManager as { getSessionFile?: () => string | null }
    ).getSessionFile?.();
    if (sessionFile) {
      emitSessionTranscriptUpdate({
        sessionFile,
        sessionKey: opts?.sessionKey,
        message,
        messageId: typeof result === "string" ? result : undefined,
      });
    }
    return result;
  };

  const flushPendingToolResults = () => {
    if (pendingState.size() === 0) {
      return;
    }
    if (allowSyntheticToolResults) {
      for (const [id, name] of pendingState.entries()) {
        const synthetic = makeMissingToolResult({ toolCallId: id, toolName: name });
        appendAndEmitTranscriptUpdate(persistMessage(synthetic));
      }
    }
    pendingState.clear();
  };

  const clearPendingToolResults = () => {
    pendingState.clear();
  };

  const guardedAppend = (message: AgentMessage) => {
    let nextMessage = message;
    const role = (message as { role?: unknown }).role;
    if (role === "assistant") {
      const sanitized = sanitizeToolCallInputs([message], {
        allowedToolNames: opts?.allowedToolNames,
      });
      if (sanitized.length === 0) {
        if (pendingState.shouldFlushForSanitizedDrop()) {
          flushPendingToolResults();
        }
        return undefined;
      }
      nextMessage = sanitized[0];
    }
    const nextRole = (nextMessage as { role?: unknown }).role;

    if (nextRole === "toolResult") {
      const id = extractToolResultId(nextMessage as Extract<AgentMessage, { role: "toolResult" }>);
      const toolName = id ? pendingState.getToolName(id) : undefined;
      if (id) {
        pendingState.delete(id);
      }
      const normalizedToolResult = normalizePersistedToolResultName(nextMessage, toolName);
      // Apply hard size cap before persistence to prevent oversized tool results
      // from consuming the entire context window on subsequent LLM calls.
      const capped = capToolResultSize(persistMessage(normalizedToolResult));
      return appendAndEmitTranscriptUpdate(capped);
    }

    // Skip tool call extraction for aborted/errored assistant messages.
    // When stopReason is "error" or "aborted", the tool_use blocks may be incomplete
    // and should not have synthetic tool_results created. Creating synthetic results
    // for incomplete tool calls causes API 400 errors:
    // "unexpected tool_use_id found in tool_result blocks"
    // This matches the behavior in repairToolUseResultPairing (session-transcript-repair.ts)
    const stopReason = (nextMessage as { stopReason?: string }).stopReason;
    const toolCalls =
      nextRole === "assistant" && stopReason !== "aborted" && stopReason !== "error"
        ? extractToolCallsFromAssistant(nextMessage as Extract<AgentMessage, { role: "assistant" }>)
        : [];

    // Always clear pending tool call state before appending non-tool-result messages.
    // flushPendingToolResults() only inserts synthetic results when allowSyntheticToolResults
    // is true; it always clears the pending map. Without this, providers that disable
    // synthetic results (e.g. OpenAI) accumulate stale pending state when a user message
    // interrupts in-flight tool calls, leaving orphaned tool_use blocks in the transcript
    // that cause API 400 errors on subsequent requests.
    if (pendingState.shouldFlushBeforeNonToolResult(nextRole, toolCalls.length)) {
      flushPendingToolResults();
    }
    // If new tool calls arrive while older ones are pending, flush the old ones first.
    if (pendingState.shouldFlushBeforeNewToolCalls(toolCalls.length)) {
      flushPendingToolResults();
    }

    const finalMessage = persistMessage(nextMessage);
    const result = appendAndEmitTranscriptUpdate(finalMessage);

    if (toolCalls.length > 0) {
      pendingState.trackToolCalls(toolCalls);
    }

    return result;
  };

  // Monkey-patch appendMessage with our guarded version.
  sessionManager.appendMessage = guardedAppend as T["appendMessage"];

  return {
    flushPendingToolResults,
    clearPendingToolResults,
    getPendingIds: pendingState.getPendingIds,
  };
}
