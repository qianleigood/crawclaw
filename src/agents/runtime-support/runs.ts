export type AgentRuntimeQueueHandle = {
  queueMessage: (text: string) => Promise<void>;
  isStreaming: () => boolean;
  isCompacting: () => boolean;
  abort: () => void;
};

export function setActiveAgentRun(
  _sessionId: string,
  _handle: AgentRuntimeQueueHandle,
  _sessionKey?: string,
): void {}

export function clearActiveAgentRun(
  _sessionId: string,
  _handle?: AgentRuntimeQueueHandle,
  _sessionKey?: string,
): void {}

export function updateActiveAgentRunSnapshot(
  _sessionId: string,
  _snapshot: Record<string, unknown>,
): void {}
