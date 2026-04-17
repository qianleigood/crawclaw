function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function buildWorkflowStatusCommand(executionId: string): string {
  return `/workflow status ${executionId.trim()}`;
}

export function buildWorkflowCancelCommand(executionId: string): string {
  return `/workflow cancel ${executionId.trim()}`;
}

export function buildWorkflowResumeCommand(executionId: string, input?: string): string {
  const trimmedExecutionId = executionId.trim();
  const trimmedInput = input?.trim();
  return trimmedInput
    ? `/workflow resume ${trimmedExecutionId} ${trimmedInput}`
    : `/workflow resume ${trimmedExecutionId}`;
}

export function buildWorkflowResumeCommandTemplate(executionId: string): string {
  return `/workflow resume ${executionId.trim()} <input>`;
}

export function buildWorkflowChannelControlCommands(executionId?: string):
  | {
      refreshCommand: string;
      cancelCommand: string;
      resumeCommand: string;
    }
  | undefined {
  const normalizedExecutionId = normalizeOptionalString(executionId);
  if (!normalizedExecutionId) {
    return undefined;
  }
  return {
    refreshCommand: buildWorkflowStatusCommand(normalizedExecutionId),
    cancelCommand: buildWorkflowCancelCommand(normalizedExecutionId),
    resumeCommand: buildWorkflowResumeCommand(normalizedExecutionId),
  };
}
