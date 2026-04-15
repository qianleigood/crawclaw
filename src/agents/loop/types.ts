export type ToolLoopCategory =
  | "plan"
  | "search"
  | "fetch"
  | "read"
  | "poll"
  | "exec"
  | "write"
  | "ask"
  | "other";

export type ProgressOutcomeClass = "pending" | "success" | "error";

export type ProgressStateDelta =
  | "unknown"
  | "same_result"
  | "new_result"
  | "same_error"
  | "new_error";

export type ProgressEnvelope = {
  toolName: string;
  toolCategory: ToolLoopCategory;
  inputFingerprint: string;
  toolCallId?: string;
  outputFingerprint?: string;
  outcomeClass: ProgressOutcomeClass;
  stateDelta: ProgressStateDelta;
  timestamp: number;
};
