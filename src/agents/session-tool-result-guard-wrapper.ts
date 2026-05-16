import {
  applyInputProvenanceToUserMessage,
  type InputProvenance,
} from "../sessions/input-provenance.js";
import {
  installSessionToolResultGuard,
  type SessionManagerLike,
} from "./session-tool-result-guard.js";

export type GuardedSessionManager<T extends SessionManagerLike = SessionManagerLike> = T & {
  /** Flush any synthetic tool results for pending tool calls. Idempotent. */
  flushPendingToolResults?: () => void;
  /** Clear pending tool calls without persisting synthetic tool results. Idempotent. */
  clearPendingToolResults?: () => void;
};

/**
 * Apply the tool-result guard to a SessionManager exactly once and expose
 * a flush method on the instance for easy teardown handling.
 */
export function guardSessionManager<T extends SessionManagerLike>(
  sessionManager: T,
  opts?: {
    agentId?: string;
    sessionKey?: string;
    inputProvenance?: InputProvenance;
    allowSyntheticToolResults?: boolean;
    allowedToolNames?: Iterable<string>;
  },
): GuardedSessionManager<T> {
  if (typeof (sessionManager as GuardedSessionManager).flushPendingToolResults === "function") {
    return sessionManager as GuardedSessionManager<T>;
  }

  const guard = installSessionToolResultGuard(sessionManager, {
    sessionKey: opts?.sessionKey,
    transformMessageForPersistence: (message) =>
      applyInputProvenanceToUserMessage(message, opts?.inputProvenance),
    allowSyntheticToolResults: opts?.allowSyntheticToolResults,
    allowedToolNames: opts?.allowedToolNames,
  });
  (sessionManager as GuardedSessionManager<T>).flushPendingToolResults =
    guard.flushPendingToolResults;
  (sessionManager as GuardedSessionManager<T>).clearPendingToolResults =
    guard.clearPendingToolResults;
  return sessionManager as GuardedSessionManager<T>;
}
