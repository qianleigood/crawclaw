export function parseSessionThreadInfo(sessionKey: string | undefined): {
  baseSessionKey: string | undefined;
  threadId: string | undefined;
} {
  if (!sessionKey) {
    return { baseSessionKey: undefined, threadId: undefined };
  }
  const marker = ":thread:";
  const markerIndex = sessionKey.indexOf(marker);
  if (markerIndex < 0) {
    return { baseSessionKey: sessionKey, threadId: undefined };
  }
  const baseSessionKey = sessionKey.slice(0, markerIndex) || undefined;
  const threadId = sessionKey.slice(markerIndex + marker.length) || undefined;
  return { baseSessionKey, threadId };
}
