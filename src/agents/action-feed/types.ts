export type AgentActionKind =
  | "system"
  | "tool"
  | "workflow"
  | "approval"
  | "guard"
  | "loop"
  | "verification"
  | "completion"
  | "memory"
  | "compaction"
  | "fallback";

export type AgentActionStatus =
  | "started"
  | "running"
  | "waiting"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type AgentActionEventData = {
  version: 1;
  actionId: string;
  parentActionId?: string;
  kind: AgentActionKind;
  status: AgentActionStatus;
  title: string;
  summary?: string;
  projectedTitle?: string;
  projectedSummary?: string;
  toolName?: string;
  toolCallId?: string;
  detail?: Record<string, unknown>;
};

export function isAgentActionEventData(value: unknown): value is AgentActionEventData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.actionId === "string" &&
    typeof record.kind === "string" &&
    typeof record.status === "string" &&
    typeof record.title === "string"
  );
}
