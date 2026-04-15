import type { ProgressEnvelope } from "../agents/loop/types.js";

// In-memory diagnostic mirror/cache only. This is not a durable truth source and
// should not be used as a replay/export record.

export type SessionStateValue = "idle" | "processing" | "waiting";

export type SessionState = {
  sessionId?: string;
  sessionKey?: string;
  lastActivity: number;
  state: SessionStateValue;
  queueDepth: number;
  loopProgressHistory?: ProgressEnvelope[];
  toolLoopWarningBuckets?: Map<string, number>;
  commandPollCounts?: Map<string, { count: number; lastPollAt: number }>;
  recentChannelStreamingDecisions?: ChannelStreamingDecisionSnapshot[];
};

export type ChannelStreamingDecisionSnapshot = {
  ts: number;
  channel: string;
  accountId?: string;
  chatId?: string | number;
  surface: "none" | "draft_stream" | "editable_draft_stream" | "card_stream";
  enabled: boolean;
  reason:
    | "enabled"
    | "disabled_by_config"
    | "disabled_for_render_mode"
    | "disabled_for_thread_reply";
};

export type SessionRef = {
  sessionId?: string;
  sessionKey?: string;
};

export type DiagnosticSessionStatePatch = {
  sessionId?: string;
  sessionKey?: string;
  lastActivity?: number;
  state?: SessionStateValue;
  queueDepth?: number;
};

export const diagnosticSessionStates = new Map<string, SessionState>();

const SESSION_STATE_TTL_MS = 30 * 60 * 1000;
const SESSION_STATE_PRUNE_INTERVAL_MS = 60 * 1000;
const SESSION_STATE_MAX_ENTRIES = 2000;
const SESSION_STREAMING_DECISION_HISTORY_LIMIT = 12;

let lastSessionPruneAt = 0;

export function pruneDiagnosticSessionStates(now = Date.now(), force = false): void {
  const shouldPruneForSize = diagnosticSessionStates.size > SESSION_STATE_MAX_ENTRIES;
  if (!force && !shouldPruneForSize && now - lastSessionPruneAt < SESSION_STATE_PRUNE_INTERVAL_MS) {
    return;
  }
  lastSessionPruneAt = now;

  for (const [key, state] of diagnosticSessionStates.entries()) {
    const ageMs = now - state.lastActivity;
    const isIdle = state.state === "idle";
    if (isIdle && state.queueDepth <= 0 && ageMs > SESSION_STATE_TTL_MS) {
      diagnosticSessionStates.delete(key);
    }
  }

  if (diagnosticSessionStates.size <= SESSION_STATE_MAX_ENTRIES) {
    return;
  }
  const excess = diagnosticSessionStates.size - SESSION_STATE_MAX_ENTRIES;
  const ordered = Array.from(diagnosticSessionStates.entries()).toSorted(
    (a, b) => a[1].lastActivity - b[1].lastActivity,
  );
  for (let i = 0; i < excess; i += 1) {
    const key = ordered[i]?.[0];
    if (!key) {
      break;
    }
    diagnosticSessionStates.delete(key);
  }
}

function resolveSessionKey({ sessionKey, sessionId }: SessionRef) {
  return sessionKey ?? sessionId ?? "unknown";
}

function findStateBySessionId(sessionId: string): SessionState | undefined {
  for (const state of diagnosticSessionStates.values()) {
    if (state.sessionId === sessionId) {
      return state;
    }
  }
  return undefined;
}

export function getDiagnosticSessionState(ref: SessionRef): SessionState {
  pruneDiagnosticSessionStates();
  const key = resolveSessionKey(ref);
  const existing =
    diagnosticSessionStates.get(key) ?? (ref.sessionId && findStateBySessionId(ref.sessionId));
  if (existing) {
    if (ref.sessionId) {
      existing.sessionId = ref.sessionId;
    }
    if (ref.sessionKey) {
      existing.sessionKey = ref.sessionKey;
    }
    return existing;
  }
  const created: SessionState = {
    sessionId: ref.sessionId,
    sessionKey: ref.sessionKey,
    lastActivity: Date.now(),
    state: "idle",
    queueDepth: 0,
  };
  diagnosticSessionStates.set(key, created);
  pruneDiagnosticSessionStates(Date.now(), true);
  return created;
}

export function peekDiagnosticSessionState(ref: SessionRef): SessionState | undefined {
  pruneDiagnosticSessionStates();
  const key = resolveSessionKey(ref);
  return (
    diagnosticSessionStates.get(key) ??
    (ref.sessionId ? findStateBySessionId(ref.sessionId) : undefined)
  );
}

export function updateDiagnosticSessionState(
  ref: SessionRef,
  patch: DiagnosticSessionStatePatch,
): SessionState {
  const state = getDiagnosticSessionState({
    sessionId: patch.sessionId ?? ref.sessionId,
    sessionKey: patch.sessionKey ?? ref.sessionKey,
  });
  if (patch.sessionId) {
    state.sessionId = patch.sessionId;
  }
  if (patch.sessionKey) {
    state.sessionKey = patch.sessionKey;
  }
  if (typeof patch.lastActivity === "number" && Number.isFinite(patch.lastActivity)) {
    state.lastActivity = patch.lastActivity;
  }
  if (patch.state === "idle" || patch.state === "processing" || patch.state === "waiting") {
    state.state = patch.state;
  }
  if (typeof patch.queueDepth === "number" && Number.isFinite(patch.queueDepth)) {
    state.queueDepth = Math.max(0, Math.trunc(patch.queueDepth));
  }
  return state;
}

export function getDiagnosticSessionStateCountForTest(): number {
  return diagnosticSessionStates.size;
}

export function recordDiagnosticChannelStreamingDecision(
  ref: SessionRef,
  decision: Omit<ChannelStreamingDecisionSnapshot, "ts"> & { ts?: number },
): SessionState {
  const state = getDiagnosticSessionState(ref);
  state.lastActivity = typeof decision.ts === "number" ? decision.ts : Date.now();
  const decisions = state.recentChannelStreamingDecisions ?? [];
  decisions.push({
    ts: typeof decision.ts === "number" ? decision.ts : Date.now(),
    channel: decision.channel,
    ...(decision.accountId ? { accountId: decision.accountId } : {}),
    ...(decision.chatId !== undefined ? { chatId: decision.chatId } : {}),
    surface: decision.surface,
    enabled: decision.enabled,
    reason: decision.reason,
  });
  if (decisions.length > SESSION_STREAMING_DECISION_HISTORY_LIMIT) {
    decisions.splice(0, decisions.length - SESSION_STREAMING_DECISION_HISTORY_LIMIT);
  }
  state.recentChannelStreamingDecisions = decisions;
  return state;
}

export function listRecentDiagnosticChannelStreamingDecisions(params?: {
  channel?: string;
  accountId?: string;
  limit?: number;
}): ChannelStreamingDecisionSnapshot[] {
  const limit = Math.max(1, Math.trunc(params?.limit ?? SESSION_STREAMING_DECISION_HISTORY_LIMIT));
  const channel = params?.channel?.trim();
  const accountId = params?.accountId?.trim();
  return Array.from(diagnosticSessionStates.values())
    .flatMap((state) => state.recentChannelStreamingDecisions ?? [])
    .filter((decision) => {
      if (channel && decision.channel !== channel) {
        return false;
      }
      if (accountId && decision.accountId !== accountId) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => right.ts - left.ts)
    .slice(0, limit);
}

export function resetDiagnosticSessionStateForTest(): void {
  diagnosticSessionStates.clear();
  lastSessionPruneAt = 0;
}
