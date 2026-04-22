import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { notifyListeners, registerListener } from "../shared/listeners.js";

export type MainSessionWakeIndicatorType = "ok" | "alert" | "error";

export type MainSessionWakeEventPayload = {
  ts: number;
  status: "sent" | "ok-empty" | "ok-token" | "skipped" | "failed";
  to?: string;
  accountId?: string;
  preview?: string;
  durationMs?: number;
  hasMedia?: boolean;
  reason?: string;
  /** The channel this wake result was sent to. */
  channel?: string;
  /** Whether the message was suppressed by visibility settings. */
  silent?: boolean;
  /** Indicator type for UI status display. */
  indicatorType?: MainSessionWakeIndicatorType;
};

export function resolveIndicatorType(
  status: MainSessionWakeEventPayload["status"],
): MainSessionWakeIndicatorType | undefined {
  switch (status) {
    case "ok-empty":
    case "ok-token":
      return "ok";
    case "sent":
      return "alert";
    case "failed":
      return "error";
    case "skipped":
      return undefined;
    default:
      return undefined;
  }
}

type MainSessionWakeEventState = {
  lastWakeEvent: MainSessionWakeEventPayload | null;
  listeners: Set<(evt: MainSessionWakeEventPayload) => void>;
};

const MAIN_SESSION_WAKE_EVENT_STATE_KEY = Symbol.for("crawclaw.mainSessionWakeEvents.state");

const state = resolveGlobalSingleton<MainSessionWakeEventState>(
  MAIN_SESSION_WAKE_EVENT_STATE_KEY,
  () => ({
    lastWakeEvent: null,
    listeners: new Set<(evt: MainSessionWakeEventPayload) => void>(),
  }),
);

export function emitMainSessionWakeEvent(evt: Omit<MainSessionWakeEventPayload, "ts">) {
  const enriched: MainSessionWakeEventPayload = { ts: Date.now(), ...evt };
  state.lastWakeEvent = enriched;
  notifyListeners(state.listeners, enriched);
}

export function onMainSessionWakeEvent(
  listener: (evt: MainSessionWakeEventPayload) => void,
): () => void {
  return registerListener(state.listeners, listener);
}

export function getLastMainSessionWakeEvent(): MainSessionWakeEventPayload | null {
  return state.lastWakeEvent;
}

export function resetMainSessionWakeEventsForTest(): void {
  state.lastWakeEvent = null;
  state.listeners.clear();
}
