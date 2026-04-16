import { getRuntimeConfigSnapshot } from "../../config/config.js";
import {
  loadSessionStore,
  resolveSessionStoreEntry,
  resolveStorePath,
} from "../../config/sessions.js";
import { emitAgentEvent, getAgentRunContext } from "../../infra/agent-events.js";
import { captureContextArchiveRunEvent } from "../context-archive/run-capture.js";
import { projectAgentActionEventData } from "./projector.js";
import type { AgentActionEventData } from "./types.js";

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveArchiveSessionId(params: {
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
}): { sessionId?: string; sessionKey?: string } {
  const sessionId = normalizeOptionalString(params.sessionId);
  const sessionKey = normalizeOptionalString(params.sessionKey);
  if (sessionId || !sessionKey) {
    return { sessionId, sessionKey };
  }
  const config = getRuntimeConfigSnapshot();
  if (!config) {
    return { sessionId: undefined, sessionKey };
  }
  try {
    const storePath = resolveStorePath(config.session?.store, {
      agentId: normalizeOptionalString(params.agentId),
    });
    const store = loadSessionStore(storePath);
    const resolved = resolveSessionStoreEntry({
      store,
      sessionKey,
    });
    return {
      sessionId: normalizeOptionalString(resolved.existing?.sessionId),
      sessionKey: resolved.normalizedKey,
    };
  } catch {
    return { sessionId: undefined, sessionKey };
  }
}

export function emitAgentActionEvent(params: {
  runId: string;
  sessionKey?: string;
  sessionId?: string;
  taskId?: string;
  agentId?: string;
  parentAgentId?: string;
  data: Omit<AgentActionEventData, "version"> & { version?: 1 };
}) {
  const projectedData = projectAgentActionEventData({
    version: 1,
    ...params.data,
  });
  const runtimeContext = getAgentRunContext(params.runId);
  const runtimeSessionKey = normalizeOptionalString(runtimeContext?.sessionKey);
  const runtimeSessionId = normalizeOptionalString(runtimeContext?.sessionId);
  const runtimeTaskId = normalizeOptionalString(runtimeContext?.taskId);
  const runtimeAgentId = normalizeOptionalString(runtimeContext?.agentId);
  const runtimeParentAgentId = normalizeOptionalString(runtimeContext?.parentAgentId);
  const emittedSessionKey = normalizeOptionalString(params.sessionKey) ?? runtimeSessionKey;
  const archiveSession = resolveArchiveSessionId({
    sessionId: normalizeOptionalString(params.sessionId) ?? runtimeSessionId,
    sessionKey: emittedSessionKey,
    agentId: normalizeOptionalString(params.agentId) ?? runtimeAgentId,
  });

  emitAgentEvent({
    runId: params.runId,
    ...(emittedSessionKey ? { sessionKey: emittedSessionKey } : {}),
    stream: "action",
    data: projectedData,
  });

  if (!archiveSession.sessionId) {
    return;
  }

  void captureContextArchiveRunEvent({
    config: getRuntimeConfigSnapshot() ?? undefined,
    source: "action-feed",
    runId: params.runId,
    sessionId: archiveSession.sessionId,
    ...(archiveSession.sessionKey ? { sessionKey: archiveSession.sessionKey } : {}),
    ...((normalizeOptionalString(params.taskId) ?? runtimeTaskId)
      ? { taskId: normalizeOptionalString(params.taskId) ?? runtimeTaskId }
      : {}),
    ...((normalizeOptionalString(params.agentId) ?? runtimeAgentId)
      ? { agentId: normalizeOptionalString(params.agentId) ?? runtimeAgentId }
      : {}),
    ...((normalizeOptionalString(params.parentAgentId) ?? runtimeParentAgentId)
      ? {
          parentAgentId: normalizeOptionalString(params.parentAgentId) ?? runtimeParentAgentId,
        }
      : {}),
    label: "action-feed",
    type: "agent.action",
    payload: {
      runId: params.runId,
      ...(archiveSession.sessionKey ? { sessionKey: archiveSession.sessionKey } : {}),
      action: {
        ...projectedData,
      },
    },
    metadata: {
      source: "action-feed",
      actionId: projectedData.actionId,
      kind: projectedData.kind,
      status: projectedData.status,
      ...(projectedData.toolName ? { toolName: projectedData.toolName } : {}),
      ...(projectedData.toolCallId ? { toolCallId: projectedData.toolCallId } : {}),
    },
  }).catch(() => {});
}
