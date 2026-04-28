import type { VerboseLevel } from "../auto-reply/thinking.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { notifyListeners, registerListener } from "../shared/listeners.js";
import type { AgentTaskMode, TaskRuntime } from "../tasks/task-registry.types.js";
import { createObservationRoot, observationRef } from "./observation/context.js";
import type { ObservationContext, ObservationRef } from "./observation/types.js";

export type AgentEventStream = "lifecycle" | "tool" | "assistant" | "error" | (string & {});

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: AgentEventStream;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
  observationRef?: ObservationRef;
};

export type AgentRunContext = {
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  parentAgentId?: string;
  taskId?: string;
  taskRuntime?: TaskRuntime;
  taskMode?: AgentTaskMode;
  label?: string;
  task?: string;
  verboseLevel?: VerboseLevel;
  isHeartbeat?: boolean;
  observation: ObservationContext;
  /** Whether browser client clients should receive chat/agent updates for this run. */
  isBrowserClientsVisible?: boolean;
};

export type AgentRunContextInput = Omit<AgentRunContext, "observation"> & {
  observation?: ObservationContext;
};

type AgentEventState = {
  seqByRun: Map<string, number>;
  listeners: Set<(evt: AgentEventPayload) => void>;
  runContextById: Map<string, AgentRunContext>;
};

const AGENT_EVENT_STATE_KEY = Symbol.for("crawclaw.agentEvents.state");

function getAgentEventState(): AgentEventState {
  return resolveGlobalSingleton<AgentEventState>(AGENT_EVENT_STATE_KEY, () => ({
    seqByRun: new Map<string, number>(),
    listeners: new Set<(evt: AgentEventPayload) => void>(),
    runContextById: new Map<string, AgentRunContext>(),
  }));
}

function normalizeAgentRunContext(runId: string, context: AgentRunContextInput): AgentRunContext {
  return {
    ...context,
    observation:
      context.observation ??
      createObservationRoot({
        source: "agent-events",
        runtime: {
          runId,
          ...(context.sessionId ? { sessionId: context.sessionId } : {}),
          ...(context.sessionKey ? { sessionKey: context.sessionKey } : {}),
          ...(context.agentId ? { agentId: context.agentId } : {}),
          ...(context.parentAgentId ? { parentAgentId: context.parentAgentId } : {}),
          ...(context.taskId ? { taskId: context.taskId } : {}),
        },
      }),
  };
}

export function registerAgentRunContext(runId: string, context: AgentRunContextInput) {
  if (!runId) {
    return;
  }
  const normalizedContext = normalizeAgentRunContext(runId, context);
  const state = getAgentEventState();
  const existing = state.runContextById.get(runId);
  if (!existing) {
    state.runContextById.set(runId, { ...normalizedContext });
    return;
  }
  if (normalizedContext.sessionKey && existing.sessionKey !== normalizedContext.sessionKey) {
    existing.sessionKey = normalizedContext.sessionKey;
  }
  if (normalizedContext.sessionId && existing.sessionId !== normalizedContext.sessionId) {
    existing.sessionId = normalizedContext.sessionId;
  }
  if (normalizedContext.agentId && existing.agentId !== normalizedContext.agentId) {
    existing.agentId = normalizedContext.agentId;
  }
  if (
    normalizedContext.parentAgentId &&
    existing.parentAgentId !== normalizedContext.parentAgentId
  ) {
    existing.parentAgentId = normalizedContext.parentAgentId;
  }
  if (normalizedContext.taskId && existing.taskId !== normalizedContext.taskId) {
    existing.taskId = normalizedContext.taskId;
  }
  if (normalizedContext.taskRuntime && existing.taskRuntime !== normalizedContext.taskRuntime) {
    existing.taskRuntime = normalizedContext.taskRuntime;
  }
  if (normalizedContext.taskMode && existing.taskMode !== normalizedContext.taskMode) {
    existing.taskMode = normalizedContext.taskMode;
  }
  if (normalizedContext.label && existing.label !== normalizedContext.label) {
    existing.label = normalizedContext.label;
  }
  if (normalizedContext.task && existing.task !== normalizedContext.task) {
    existing.task = normalizedContext.task;
  }
  if (normalizedContext.verboseLevel && existing.verboseLevel !== normalizedContext.verboseLevel) {
    existing.verboseLevel = normalizedContext.verboseLevel;
  }
  if (normalizedContext.isBrowserClientsVisible !== undefined) {
    existing.isBrowserClientsVisible = normalizedContext.isBrowserClientsVisible;
  }
  if (
    normalizedContext.isHeartbeat !== undefined &&
    existing.isHeartbeat !== normalizedContext.isHeartbeat
  ) {
    existing.isHeartbeat = normalizedContext.isHeartbeat;
  }
  existing.observation = normalizedContext.observation;
}

export function getAgentRunContext(runId: string) {
  return getAgentEventState().runContextById.get(runId);
}

export function listAgentRunContexts(): Array<{ runId: string; context: AgentRunContext }> {
  return [...getAgentEventState().runContextById.entries()].map(([runId, context]) => ({
    runId,
    context,
  }));
}

export function clearAgentRunContext(runId: string) {
  getAgentEventState().runContextById.delete(runId);
}

export function resetAgentRunContextForTest() {
  getAgentEventState().runContextById.clear();
}

export function emitAgentEvent(event: Omit<AgentEventPayload, "seq" | "ts">) {
  const state = getAgentEventState();
  const nextSeq = (state.seqByRun.get(event.runId) ?? 0) + 1;
  state.seqByRun.set(event.runId, nextSeq);
  const context = state.runContextById.get(event.runId);
  const isBrowserClientsVisible = context?.isBrowserClientsVisible ?? true;
  const eventSessionKey =
    typeof event.sessionKey === "string" && event.sessionKey.trim() ? event.sessionKey : undefined;
  const sessionKey = isBrowserClientsVisible ? (eventSessionKey ?? context?.sessionKey) : undefined;
  const enriched: AgentEventPayload = {
    ...event,
    sessionKey,
    ...(context?.observation ? { observationRef: observationRef(context.observation) } : {}),
    seq: nextSeq,
    ts: Date.now(),
  };
  notifyListeners(state.listeners, enriched);
}

export function onAgentEvent(listener: (evt: AgentEventPayload) => void) {
  const state = getAgentEventState();
  return registerListener(state.listeners, listener);
}

export function resetAgentEventsForTest() {
  const state = getAgentEventState();
  state.seqByRun.clear();
  state.listeners.clear();
  state.runContextById.clear();
}
