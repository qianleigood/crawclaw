export type EmbeddedPiQueueHandle = {
  queueMessage: (text: string) => Promise<void>;
  isStreaming: () => boolean;
  isCompacting: () => boolean;
  abort: () => void;
};

export function setActiveEmbeddedRun(
  _sessionId: string,
  _handle: EmbeddedPiQueueHandle,
  _sessionKey?: string,
): void {}

export function clearActiveEmbeddedRun(
  _sessionId: string,
  _handle?: EmbeddedPiQueueHandle,
  _sessionKey?: string,
): void {}

export function updateActiveEmbeddedRunSnapshot(
  _sessionId: string,
  _snapshot: Record<string, unknown>,
): void {}
