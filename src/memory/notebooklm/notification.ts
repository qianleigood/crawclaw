import type { NotebookLmProviderState } from "./provider-state.ts";

type RuntimeLogger = { warn(message: string): void; info?(message: string): void };

type NotebookLmNotificationScope = {
  agentId?: string | null;
  channel?: string | null;
  userId?: string | null;
  source?: "query" | "write" | "heartbeat";
};

type NotificationEntry = {
  lastNotifiedAt: number;
  lifecycle: NotebookLmProviderState["lifecycle"];
  reason: NotebookLmProviderState["reason"];
};

const notificationCache = new Map<string, NotificationEntry>();
const DEFAULT_NOTIFICATION_INTERVAL_MS = 30 * 60_000;

function buildNotificationKey(
  state: NotebookLmProviderState,
  scope?: NotebookLmNotificationScope,
): string {
  return JSON.stringify({
    source: scope?.source ?? "query",
    agentId: scope?.agentId ?? "",
    channel: scope?.channel ?? "",
    userId: scope?.userId ?? "",
    lifecycle: state.lifecycle,
    reason: state.reason ?? "",
  });
}

function buildNotificationMessage(state: NotebookLmProviderState): string {
  const action = state.recommendedAction ?? "crawclaw memory status";
  if (state.lifecycle === "ready") {
    return `[memory] NotebookLM 已恢复，知识库功能可用。可执行 ${action} 查看状态。`;
  }
  const reason = state.reason ?? "unknown";
  return `[memory] NotebookLM 登录已失效，知识库功能当前已降级。reason=${reason}. 请执行 ${action}。`;
}

export function resetNotebookLmNotificationsForTests(): void {
  notificationCache.clear();
}

export function emitNotebookLmNotification(params: {
  state: NotebookLmProviderState;
  logger: RuntimeLogger;
  scope?: NotebookLmNotificationScope;
  minIntervalMs?: number;
}): boolean {
  const state = params.state;
  if (state.lifecycle !== "degraded" && state.lifecycle !== "expired" && state.lifecycle !== "ready") {
    return false;
  }
  const key = buildNotificationKey(state, params.scope);
  const now = Date.now();
  const minIntervalMs = Math.max(60_000, params.minIntervalMs ?? DEFAULT_NOTIFICATION_INTERVAL_MS);
  const previous = notificationCache.get(key);
  if (previous && now - previous.lastNotifiedAt < minIntervalMs) {
    return false;
  }
  notificationCache.set(key, {
    lastNotifiedAt: now,
    lifecycle: state.lifecycle,
    reason: state.reason,
  });
  const message = buildNotificationMessage(state);
  if (state.lifecycle === "ready") {
    params.logger.info?.(message);
  } else {
    params.logger.warn(message);
  }
  return true;
}
