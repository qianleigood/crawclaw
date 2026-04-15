type PinchTabSessionState = {
  instanceId?: string;
  tabId?: string;
  profileId?: string;
};

const sessionState = new Map<string, PinchTabSessionState>();

export function getPinchTabSessionState(sessionName: string): PinchTabSessionState {
  return sessionState.get(sessionName) ?? {};
}

export function updatePinchTabSessionState(
  sessionName: string,
  patch: Partial<PinchTabSessionState>,
): PinchTabSessionState {
  const next = { ...getPinchTabSessionState(sessionName), ...patch };
  sessionState.set(sessionName, next);
  return next;
}

export function clearPinchTabSessionState(sessionName: string) {
  sessionState.delete(sessionName);
}

export const __testing = {
  reset() {
    sessionState.clear();
  },
};
