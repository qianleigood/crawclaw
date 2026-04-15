import { emitAgentEvent, onAgentEvent, type AgentEventPayload } from "../../infra/agent-events.js";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import { notifyListeners, registerListener } from "../../shared/listeners.js";
import { recordTaskRunProgressByRunId } from "../../tasks/task-executor.js";
import type { AgentTaskMode, TaskRuntime } from "../../tasks/task-registry.types.js";
import { emitAgentActionEvent } from "../action-feed/emit.js";
import {
  ensureTaskTrajectoryBridge,
  recordTaskTrajectoryProgressEvent,
} from "../tasks/task-trajectory.js";
import {
  clearAgentRuntimeState,
  getAgentRuntimeState,
  incrementAgentRuntimeToolCall,
  markAgentRuntimeStateTerminal,
  registerAgentRuntimeState,
  resetAgentRuntimeStateForTest,
  type AgentRuntimeState,
  type AgentRuntimeStatePatch,
  type AgentRuntimeStatus,
} from "./agent-runtime-state.js";

export type AgentProgressKind =
  | "agent_started"
  | "tool_called"
  | "tool_completed"
  | "agent_progressed"
  | "agent_completed"
  | "agent_failed"
  | "agent_cancelled";

export type AgentProgressEvent = {
  kind: AgentProgressKind;
  at: number;
  runId: string;
  status: AgentRuntimeStatus;
  taskId?: string;
  runtime?: TaskRuntime;
  mode?: AgentTaskMode;
  agentId?: string;
  parentAgentId?: string;
  sessionId?: string;
  sessionKey?: string;
  summary?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
};

type AgentProgressState = {
  listeners: Set<(event: AgentProgressEvent) => void>;
  bridgeStop?: () => void;
};

const AGENT_PROGRESS_STATE_KEY = Symbol.for("crawclaw.agentProgress.state");

function getAgentProgressState(): AgentProgressState {
  return resolveGlobalSingleton<AgentProgressState>(AGENT_PROGRESS_STATE_KEY, () => ({
    listeners: new Set<(event: AgentProgressEvent) => void>(),
  }));
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildProgressEvent(params: {
  state: AgentRuntimeState;
  kind: AgentProgressKind;
  at: number;
  summary?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
}): AgentProgressEvent {
  return {
    kind: params.kind,
    at: params.at,
    runId: params.state.runId,
    status: params.state.status,
    ...(params.state.taskId ? { taskId: params.state.taskId } : {}),
    ...(params.state.runtime ? { runtime: params.state.runtime } : {}),
    ...(params.state.mode ? { mode: params.state.mode } : {}),
    ...(params.state.agentId ? { agentId: params.state.agentId } : {}),
    ...(params.state.parentAgentId ? { parentAgentId: params.state.parentAgentId } : {}),
    ...(params.state.sessionId ? { sessionId: params.state.sessionId } : {}),
    ...(params.state.sessionKey ? { sessionKey: params.state.sessionKey } : {}),
    ...(params.summary ? { summary: params.summary } : {}),
    ...(params.toolName ? { toolName: params.toolName } : {}),
    ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
    ...(typeof params.isError === "boolean" ? { isError: params.isError } : {}),
  };
}

function emitProgressEvent(event: AgentProgressEvent): void {
  notifyListeners(getAgentProgressState().listeners, event);
  recordTaskTrajectoryProgressEvent(event);
  maybeEmitActionEvent(event);
}

function maybeEmitActionEvent(event: AgentProgressEvent): void {
  if (event.kind === "agent_progressed") {
    return;
  }

  const runActionId = `run:${event.runId}`;
  const toolActionId = event.toolCallId ? `tool:${event.toolCallId}` : undefined;
  const baseDetail: Record<string, unknown> = {
    ...(event.runtime ? { runtime: event.runtime } : {}),
    ...(event.mode ? { mode: event.mode } : {}),
    ...(event.agentId ? { agentId: event.agentId } : {}),
    ...(event.parentAgentId ? { parentAgentId: event.parentAgentId } : {}),
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
  };

  switch (event.kind) {
    case "agent_started":
      emitAgentActionEvent({
        runId: event.runId,
        sessionKey: event.sessionKey,
        data: {
          actionId: runActionId,
          kind: "system",
          status: "started",
          title: event.summary ?? "Agent started",
          ...(event.summary ? { summary: event.summary } : {}),
          detail: baseDetail,
        },
      });
      return;
    case "tool_called":
      emitAgentActionEvent({
        runId: event.runId,
        sessionKey: event.sessionKey,
        data: {
          actionId: toolActionId ?? `tool:${event.runId}:${event.toolName ?? "tool"}`,
          parentActionId: runActionId,
          kind: "tool",
          status: "running",
          title: event.toolName ? `Running ${event.toolName}` : "Running tool",
          ...(event.summary ? { summary: event.summary } : {}),
          ...(event.toolName ? { toolName: event.toolName } : {}),
          ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
          detail: baseDetail,
        },
      });
      return;
    case "tool_completed":
      emitAgentActionEvent({
        runId: event.runId,
        sessionKey: event.sessionKey,
        data: {
          actionId: toolActionId ?? `tool:${event.runId}:${event.toolName ?? "tool"}`,
          parentActionId: runActionId,
          kind: "tool",
          status: event.isError ? "failed" : "completed",
          title: event.toolName
            ? event.isError
              ? `${event.toolName} failed`
              : `${event.toolName} completed`
            : event.isError
              ? "Tool failed"
              : "Tool completed",
          ...(event.summary ? { summary: event.summary } : {}),
          ...(event.toolName ? { toolName: event.toolName } : {}),
          ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
          detail: {
            ...baseDetail,
            ...(typeof event.isError === "boolean" ? { isError: event.isError } : {}),
          },
        },
      });
      return;
    case "agent_completed":
      emitAgentActionEvent({
        runId: event.runId,
        sessionKey: event.sessionKey,
        data: {
          actionId: runActionId,
          kind: "system",
          status: "completed",
          title: event.summary ?? "Agent completed",
          ...(event.summary ? { summary: event.summary } : {}),
          detail: baseDetail,
        },
      });
      return;
    case "agent_failed":
      emitAgentActionEvent({
        runId: event.runId,
        sessionKey: event.sessionKey,
        data: {
          actionId: runActionId,
          kind: "system",
          status: "failed",
          title: event.summary ?? "Agent failed",
          ...(event.summary ? { summary: event.summary } : {}),
          detail: {
            ...baseDetail,
            ...(typeof event.isError === "boolean" ? { isError: event.isError } : {}),
          },
        },
      });
      return;
    case "agent_cancelled":
      emitAgentActionEvent({
        runId: event.runId,
        sessionKey: event.sessionKey,
        data: {
          actionId: runActionId,
          kind: "system",
          status: "cancelled",
          title: event.summary ?? "Agent cancelled",
          ...(event.summary ? { summary: event.summary } : {}),
          detail: {
            ...baseDetail,
            ...(typeof event.isError === "boolean" ? { isError: event.isError } : {}),
          },
        },
      });
      return;
  }
}

function buildTaskProgressSummary(toolName: string, suffix: "started" | "completed" | "failed") {
  if (suffix === "started") {
    return `Running ${toolName}`;
  }
  if (suffix === "failed") {
    return `${toolName} failed`;
  }
  return `${toolName} completed`;
}

function updateTaskProgressFromState(params: {
  state: AgentRuntimeState;
  at: number;
  toolName: string;
  suffix: "started" | "completed" | "failed";
}) {
  if (!params.state.runtime || !params.state.taskId) {
    return;
  }
  try {
    recordTaskRunProgressByRunId({
      runId: params.state.runId,
      runtime: params.state.runtime,
      sessionKey: params.state.sessionKey,
      lastEventAt: params.at,
      progressSummary: buildTaskProgressSummary(params.toolName, params.suffix),
      eventSummary: buildTaskProgressSummary(params.toolName, params.suffix),
    });
  } catch {
    // Task progress updates are best-effort only.
  }
}

function extractLifecyclePhase(event: AgentEventPayload): string | undefined {
  return typeof event.data?.phase === "string" ? event.data.phase : undefined;
}

function extractToolName(event: AgentEventPayload): string | undefined {
  return normalizeOptionalString(
    typeof event.data?.name === "string" ? event.data.name : undefined,
  );
}

function extractToolCallId(event: AgentEventPayload): string | undefined {
  return normalizeOptionalString(
    typeof event.data?.toolCallId === "string" ? event.data.toolCallId : undefined,
  );
}

function handleLifecycleEvent(event: AgentEventPayload): void {
  const phase = extractLifecyclePhase(event);
  if (!phase) {
    return;
  }
  if (phase === "start") {
    const startedAt = typeof event.data?.startedAt === "number" ? event.data.startedAt : event.ts;
    const state = registerAgentRuntimeState({
      runId: event.runId,
      status: "running",
      startedAt,
      updatedAt: startedAt,
    });
    emitProgressEvent(
      buildProgressEvent({
        state,
        kind: "agent_started",
        at: startedAt,
        summary: state.label ?? state.task ?? "Agent started",
      }),
    );
    return;
  }

  if (phase === "end") {
    const terminal = markAgentRuntimeStateTerminal({
      runId: event.runId,
      status: "completed",
      endedAt: typeof event.data?.endedAt === "number" ? event.data.endedAt : event.ts,
    });
    if (!terminal.changed) {
      return;
    }
    emitProgressEvent(
      buildProgressEvent({
        state: terminal.state,
        kind: "agent_completed",
        at: terminal.state.endedAt ?? event.ts,
        summary: "Agent completed",
      }),
    );
    return;
  }

  if (phase === "error") {
    const errorText = normalizeOptionalString(
      typeof event.data?.error === "string" ? event.data.error : undefined,
    );
    const terminal = markAgentRuntimeStateTerminal({
      runId: event.runId,
      status: "failed",
      endedAt: typeof event.data?.endedAt === "number" ? event.data.endedAt : event.ts,
      error: errorText,
    });
    if (!terminal.changed) {
      return;
    }
    emitProgressEvent(
      buildProgressEvent({
        state: terminal.state,
        kind: "agent_failed",
        at: terminal.state.endedAt ?? event.ts,
        summary: errorText ?? "Agent failed",
        isError: true,
      }),
    );
  }
}

function handleToolEvent(event: AgentEventPayload): void {
  const phase = extractLifecyclePhase(event);
  const toolName = extractToolName(event);
  if (!phase || !toolName) {
    return;
  }

  if (phase === "start") {
    const state = incrementAgentRuntimeToolCall({
      runId: event.runId,
      toolName,
      currentStep: `tool:${toolName}`,
      updatedAt: event.ts,
    });
    updateTaskProgressFromState({
      state,
      at: event.ts,
      toolName,
      suffix: "started",
    });
    emitProgressEvent(
      buildProgressEvent({
        state,
        kind: "tool_called",
        at: event.ts,
        summary: `Calling ${toolName}`,
        toolName,
        toolCallId: extractToolCallId(event),
      }),
    );
    return;
  }

  if (phase !== "result") {
    return;
  }

  const isError = event.data?.isError === true;
  const state = registerAgentRuntimeState({
    runId: event.runId,
    status: "running",
    currentStep: `tool:${toolName}`,
    lastToolName: toolName,
    updatedAt: event.ts,
  });
  updateTaskProgressFromState({
    state,
    at: event.ts,
    toolName,
    suffix: isError ? "failed" : "completed",
  });
  emitProgressEvent(
    buildProgressEvent({
      state,
      kind: "tool_completed",
      at: event.ts,
      summary: isError ? `${toolName} failed` : `${toolName} completed`,
      toolName,
      toolCallId: extractToolCallId(event),
      isError,
    }),
  );
  emitProgressEvent(
    buildProgressEvent({
      state,
      kind: "agent_progressed",
      at: event.ts,
      summary: isError ? `${toolName} failed` : `${toolName} completed`,
      toolName,
      toolCallId: extractToolCallId(event),
      isError,
    }),
  );
}

function handleAgentEvent(event: AgentEventPayload): void {
  if (event.stream === "lifecycle") {
    handleLifecycleEvent(event);
    return;
  }
  if (event.stream === "tool") {
    handleToolEvent(event);
  }
}

export function ensureAgentProgressBridge(): void {
  const state = getAgentProgressState();
  if (state.bridgeStop) {
    return;
  }
  ensureTaskTrajectoryBridge();
  state.bridgeStop = onAgentEvent(handleAgentEvent);
}

export function onAgentProgressEvent(listener: (event: AgentProgressEvent) => void) {
  ensureAgentProgressBridge();
  return registerListener(getAgentProgressState().listeners, listener);
}

export function registerAgentRuntimeRun(params: { runId: string } & AgentRuntimeStatePatch) {
  ensureAgentProgressBridge();
  return registerAgentRuntimeState(params);
}

export function markAgentRunCompleted(params: {
  runId: string;
  endedAt?: number;
  summary?: string;
}) {
  ensureAgentProgressBridge();
  const terminal = markAgentRuntimeStateTerminal({
    runId: params.runId,
    status: "completed",
    endedAt: params.endedAt,
  });
  if (terminal.changed) {
    emitProgressEvent(
      buildProgressEvent({
        state: terminal.state,
        kind: "agent_completed",
        at: terminal.state.endedAt ?? Date.now(),
        summary: params.summary ?? "Agent completed",
      }),
    );
    emitAgentEvent({
      runId: params.runId,
      stream: "lifecycle",
      data: {
        phase: "end",
        ...(typeof terminal.state.startedAt === "number"
          ? { startedAt: terminal.state.startedAt }
          : {}),
        ...(typeof terminal.state.endedAt === "number" ? { endedAt: terminal.state.endedAt } : {}),
      },
    });
  }
  return terminal.state;
}

export function markAgentRunFailed(params: {
  runId: string;
  endedAt?: number;
  error?: string;
  summary?: string;
}) {
  ensureAgentProgressBridge();
  const terminal = markAgentRuntimeStateTerminal({
    runId: params.runId,
    status: "failed",
    endedAt: params.endedAt,
    error: params.error,
  });
  if (terminal.changed) {
    emitProgressEvent(
      buildProgressEvent({
        state: terminal.state,
        kind: "agent_failed",
        at: terminal.state.endedAt ?? Date.now(),
        summary: params.summary ?? params.error ?? "Agent failed",
        isError: true,
      }),
    );
    emitAgentEvent({
      runId: params.runId,
      stream: "lifecycle",
      data: {
        phase: "error",
        ...(typeof terminal.state.startedAt === "number"
          ? { startedAt: terminal.state.startedAt }
          : {}),
        ...(typeof terminal.state.endedAt === "number" ? { endedAt: terminal.state.endedAt } : {}),
        ...(params.error ? { error: params.error } : {}),
      },
    });
  }
  return terminal.state;
}

export function markAgentRunCancelled(params: {
  runId: string;
  endedAt?: number;
  summary?: string;
}) {
  ensureAgentProgressBridge();
  const terminal = markAgentRuntimeStateTerminal({
    runId: params.runId,
    status: "cancelled",
    endedAt: params.endedAt,
    error: params.summary,
  });
  if (terminal.changed) {
    emitProgressEvent(
      buildProgressEvent({
        state: terminal.state,
        kind: "agent_cancelled",
        at: terminal.state.endedAt ?? Date.now(),
        summary: params.summary ?? "Agent cancelled",
        isError: true,
      }),
    );
    emitAgentEvent({
      runId: params.runId,
      stream: "lifecycle",
      data: {
        phase: "error",
        ...(typeof terminal.state.startedAt === "number"
          ? { startedAt: terminal.state.startedAt }
          : {}),
        ...(typeof terminal.state.endedAt === "number" ? { endedAt: terminal.state.endedAt } : {}),
        ...(params.summary ? { error: params.summary } : {}),
      },
    });
  }
  return terminal.state;
}

export function resetAgentProgressEventsForTest(): void {
  const state = getAgentProgressState();
  state.listeners.clear();
  state.bridgeStop?.();
  state.bridgeStop = undefined;
  resetAgentRuntimeStateForTest();
}

export { clearAgentRuntimeState, getAgentRuntimeState };
