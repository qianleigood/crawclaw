import type { emitAgentActionEvent } from "../../action-feed/emit.js";
import type { AgentActionKind, AgentActionStatus } from "../../action-feed/types.js";

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function emitSpecialAgentActionEvent(params: {
  emitAgentActionEvent: typeof emitAgentActionEvent;
  runId: string;
  actionId: string;
  kind: AgentActionKind;
  sessionKey?: string;
  agentId?: string | null;
  status: AgentActionStatus;
  title: string;
  summary?: string;
  projectedTitle?: string;
  projectedSummary?: string;
  detail?: Record<string, unknown>;
}): void {
  params.emitAgentActionEvent({
    runId: params.runId,
    ...(normalizeOptionalString(params.sessionKey)
      ? { sessionKey: normalizeOptionalString(params.sessionKey) }
      : {}),
    ...(normalizeOptionalString(params.agentId)
      ? { agentId: normalizeOptionalString(params.agentId) }
      : {}),
    data: {
      actionId: params.actionId,
      kind: params.kind,
      status: params.status,
      title: params.title,
      ...(normalizeOptionalString(params.summary)
        ? { summary: normalizeOptionalString(params.summary) }
        : {}),
      ...(normalizeOptionalString(params.projectedTitle)
        ? { projectedTitle: normalizeOptionalString(params.projectedTitle) }
        : {}),
      ...(normalizeOptionalString(params.projectedSummary)
        ? { projectedSummary: normalizeOptionalString(params.projectedSummary) }
        : {}),
      ...(params.detail ? { detail: params.detail } : {}),
    },
  });
}
