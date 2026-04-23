import { Container, Loader, Text, type TUI } from "@mariozechner/pi-tui";
import { theme } from "./theme/theme.js";
import { formatTuiStatusText } from "./tui-formatters.js";
import { buildWaitingStatusMessage, defaultWaitingPhrases } from "./tui-waiting.js";

const BUSY_STATUSES = new Set(["sending", "waiting", "streaming", "running"]);

export function isBusyStatus(status: string) {
  return BUSY_STATUSES.has(status);
}

export function formatStatusElapsed(startMs: number, nowMs = Date.now()) {
  const totalSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function formatIdleStatusText(connectionStatus: string, activityStatus: string) {
  const connection = formatTuiStatusText(connectionStatus);
  const activity = formatTuiStatusText(activityStatus);
  return activity ? `${connection} | ${activity}` : connection;
}

export function createTuiStatusLineController(params: {
  tui: TUI;
  statusContainer: Container;
  getConnectionStatus: () => string;
  setConnectionStatusValue: (value: string) => void;
  getActivityStatus: () => string;
  setActivityStatusValue: (value: string) => void;
  getIsConnected: () => boolean;
  getStatusTimeout: () => ReturnType<typeof setTimeout> | null;
  setStatusTimeout: (value: ReturnType<typeof setTimeout> | null) => void;
}) {
  let statusText: Text | null = null;
  let statusLoader: Loader | null = null;
  let statusStartedAt: number | null = null;
  let lastActivityStatus = params.getActivityStatus();
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  let waitingTick = 0;
  let waitingTimer: ReturnType<typeof setInterval> | null = null;
  let waitingPhrase: string | null = null;

  const ensureStatusText = () => {
    if (statusText) {
      return;
    }
    params.statusContainer.clear();
    statusLoader?.stop();
    statusLoader = null;
    statusText = new Text("", 1, 0);
    params.statusContainer.addChild(statusText);
  };

  const ensureStatusLoader = () => {
    if (statusLoader) {
      return;
    }
    params.statusContainer.clear();
    statusText = null;
    statusLoader = new Loader(
      params.tui,
      (spinner) => theme.accent(spinner),
      (text) => theme.bold(theme.accentSoft(text)),
      "",
    );
    params.statusContainer.addChild(statusLoader);
  };

  const updateBusyStatusMessage = () => {
    if (!statusLoader || !statusStartedAt) {
      return;
    }
    const activityStatus = params.getActivityStatus();
    const connectionStatus = params.getConnectionStatus();
    const elapsed = formatStatusElapsed(statusStartedAt);

    if (activityStatus === "waiting") {
      waitingTick++;
      statusLoader.setMessage(
        buildWaitingStatusMessage({
          theme,
          tick: waitingTick,
          elapsed,
          connectionStatus,
          phrases: waitingPhrase ? [waitingPhrase] : undefined,
        }),
      );
      return;
    }

    statusLoader.setMessage(`${activityStatus} • ${elapsed} | ${connectionStatus}`);
  };

  const stopStatusTimer = () => {
    if (!statusTimer) {
      return;
    }
    clearInterval(statusTimer);
    statusTimer = null;
  };

  const startStatusTimer = () => {
    if (statusTimer) {
      return;
    }
    statusTimer = setInterval(() => {
      if (!isBusyStatus(params.getActivityStatus())) {
        return;
      }
      updateBusyStatusMessage();
    }, 1000);
  };

  const stopWaitingTimer = () => {
    if (!waitingTimer) {
      return;
    }
    clearInterval(waitingTimer);
    waitingTimer = null;
    waitingPhrase = null;
  };

  const startWaitingTimer = () => {
    if (waitingTimer) {
      return;
    }
    if (!waitingPhrase) {
      const idx = Math.floor(Math.random() * defaultWaitingPhrases.length);
      waitingPhrase = defaultWaitingPhrases[idx] ?? defaultWaitingPhrases[0] ?? "waiting";
    }

    waitingTick = 0;
    waitingTimer = setInterval(() => {
      if (params.getActivityStatus() !== "waiting") {
        return;
      }
      updateBusyStatusMessage();
    }, 120);
  };

  const renderStatus = () => {
    const activityStatus = params.getActivityStatus();
    if (isBusyStatus(activityStatus)) {
      if (!statusStartedAt || lastActivityStatus !== activityStatus) {
        statusStartedAt = Date.now();
      }
      ensureStatusLoader();
      if (activityStatus === "waiting") {
        stopStatusTimer();
        startWaitingTimer();
      } else {
        stopWaitingTimer();
        startStatusTimer();
      }
      updateBusyStatusMessage();
    } else {
      statusStartedAt = null;
      stopStatusTimer();
      stopWaitingTimer();
      statusLoader?.stop();
      statusLoader = null;
      ensureStatusText();
      statusText?.setText(
        theme.dim(formatIdleStatusText(params.getConnectionStatus(), activityStatus)),
      );
    }
    lastActivityStatus = activityStatus;
  };

  const setConnectionStatus = (text: string, ttlMs?: number) => {
    params.setConnectionStatusValue(text);
    renderStatus();
    const existing = params.getStatusTimeout();
    if (existing) {
      clearTimeout(existing);
    }
    params.setStatusTimeout(null);
    if (ttlMs && ttlMs > 0) {
      params.setStatusTimeout(
        setTimeout(() => {
          params.setConnectionStatusValue(params.getIsConnected() ? "connected" : "disconnected");
          params.setStatusTimeout(null);
          renderStatus();
        }, ttlMs),
      );
    }
  };

  const setActivityStatus = (text: string) => {
    params.setActivityStatusValue(text);
    renderStatus();
  };

  const stop = () => {
    stopStatusTimer();
    stopWaitingTimer();
    const existing = params.getStatusTimeout();
    if (existing) {
      clearTimeout(existing);
      params.setStatusTimeout(null);
    }
    statusLoader?.stop();
  };

  return {
    renderStatus,
    setConnectionStatus,
    setActivityStatus,
    stop,
  };
}
