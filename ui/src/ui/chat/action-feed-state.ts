import { projectAgentActionEventData } from "../../../../src/agents/action-feed/projector.js";
import { isAgentActionEventData } from "../../../../src/agents/action-feed/types.js";

const ACTION_FEED_LIMIT = 24;

export type AgentActionEntry = {
  actionId: string;
  kind: string;
  title: string;
  status: "started" | "running" | "waiting" | "completed" | "blocked" | "cancelled" | "failed";
  summary?: string;
  projectedTitle?: string;
  projectedSummary?: string;
  detail?: unknown;
  runId: string;
  sessionKey?: string;
  updatedAt: number;
  [key: string]: unknown;
};

export type ActionFeedEntry = AgentActionEntry;

type ActionFeedHost = {
  sessionKey: string;
  chatRunId: string | null;
  actionFeedById?: Map<string, AgentActionEntry>;
  actionFeedOrder?: string[];
  chatActionFeed?: AgentActionEntry[];
};

type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: string;
  ts: number;
  sessionKey?: string;
  data: Record<string, unknown>;
};

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function ensureActionFeedState(host: ActionFeedHost) {
  if (!(host.actionFeedById instanceof Map)) {
    host.actionFeedById = new Map<string, AgentActionEntry>();
  }
  if (!Array.isArray(host.actionFeedOrder)) {
    host.actionFeedOrder = [];
  }
  if (!Array.isArray(host.chatActionFeed)) {
    host.chatActionFeed = [];
  }
}

function resolveAcceptedSession(
  host: ActionFeedHost,
  payload: Pick<AgentEventPayload, "runId" | "sessionKey">,
  options?: { allowSessionScopedWhenIdle?: boolean; allowSessionScoped?: boolean },
): boolean {
  const sessionKey = normalizeOptionalString(payload.sessionKey);
  if (sessionKey && sessionKey !== host.sessionKey) {
    return false;
  }
  if (sessionKey && options?.allowSessionScoped) {
    return true;
  }
  if (!host.chatRunId && options?.allowSessionScopedWhenIdle && sessionKey) {
    return true;
  }
  if (!sessionKey && host.chatRunId && payload.runId !== host.chatRunId) {
    return false;
  }
  if (host.chatRunId && payload.runId !== host.chatRunId) {
    return false;
  }
  return Boolean(host.chatRunId);
}

function syncActionFeed(host: ActionFeedHost) {
  ensureActionFeedState(host);
  const actionFeedOrder = host.actionFeedOrder!;
  const actionFeedById = host.actionFeedById!;
  actionFeedOrder.sort((left, right) => {
    const leftEntry = actionFeedById.get(left);
    const rightEntry = actionFeedById.get(right);
    return (rightEntry?.updatedAt ?? 0) - (leftEntry?.updatedAt ?? 0);
  });
  host.chatActionFeed = actionFeedOrder
    .map((id) => actionFeedById.get(id))
    .filter((entry): entry is AgentActionEntry => Boolean(entry));
}

function pruneActionFeed(host: ActionFeedHost) {
  ensureActionFeedState(host);
  const actionFeedOrder = host.actionFeedOrder!;
  const actionFeedById = host.actionFeedById!;
  if (actionFeedOrder.length <= ACTION_FEED_LIMIT) {
    return;
  }
  const overflow = actionFeedOrder.splice(ACTION_FEED_LIMIT);
  for (const id of overflow) {
    actionFeedById.delete(id);
  }
}

function upsertActionEntry(host: ActionFeedHost, entry: AgentActionEntry) {
  ensureActionFeedState(host);
  const actionFeedById = host.actionFeedById!;
  const actionFeedOrder = host.actionFeedOrder!;
  const existing = actionFeedById.get(entry.actionId);
  if (existing) {
    actionFeedById.set(entry.actionId, {
      ...existing,
      ...entry,
      updatedAt: entry.updatedAt,
    });
  } else {
    actionFeedById.set(entry.actionId, entry);
    actionFeedOrder.unshift(entry.actionId);
  }
  pruneActionFeed(host);
  syncActionFeed(host);
}

function handleRawAgentAction(host: ActionFeedHost, payload: AgentEventPayload) {
  if (!isAgentActionEventData(payload.data)) {
    return;
  }
  const projected = projectAgentActionEventData(payload.data) as unknown as Record<string, unknown>;
  if (
    !resolveAcceptedSession(host, payload, {
      allowSessionScopedWhenIdle: true,
      allowSessionScoped:
        projected.kind === "approval" ||
        projected.kind === "verification" ||
        projected.kind === "memory" ||
        projected.kind === "workflow",
    })
  ) {
    return;
  }
  const nextEntry = {
    ...projected,
    runId: payload.runId,
    ...(payload.sessionKey ? { sessionKey: payload.sessionKey } : {}),
    updatedAt: payload.ts,
  } as AgentActionEntry;
  upsertActionEntry(host, nextEntry);
}

export function handleAgentActionEvent(host: ActionFeedHost, payload?: AgentEventPayload) {
  if (!payload) {
    return;
  }
  if (payload.stream === "action") {
    handleRawAgentAction(host, payload);
  }
}

export function resetActionFeed(host: ActionFeedHost) {
  ensureActionFeedState(host);
  host.actionFeedById!.clear();
  host.actionFeedOrder = [];
  host.chatActionFeed = [];
}
