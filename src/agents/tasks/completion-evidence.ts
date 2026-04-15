export type CompletionEvidenceKind =
  | "answer_provided"
  | "file_changed"
  | "test_passed"
  | "assertion_met"
  | "external_state_changed"
  | "user_confirmed";

export type CompletionEvidence = {
  kind: CompletionEvidenceKind;
  at: number;
  summary: string;
  toolName?: string;
  toolCallId?: string;
  path?: string;
  command?: string;
  confidence?: number;
  source?: "assistant" | "tool" | "user";
};
