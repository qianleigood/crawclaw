import { promises as fs } from "node:fs";
import path from "node:path";
import type { CrawClawPluginApi } from "./api.js";
import { listDevicePairing } from "./api.js";

const NOTIFY_STATE_FILE = "device-pair-notify.json";
const NOTIFY_POLL_INTERVAL_MS = 10_000;
const NOTIFY_MAX_SEEN_AGE_MS = 24 * 60 * 60 * 1000;

type NotifySubscription = {
  to: string;
  accountId?: string;
  messageThreadId?: string | number;
  mode: "persistent" | "once";
  addedAtMs: number;
};

type NotifyStateFile = {
  subscribers: NotifySubscription[];
  notifiedRequestIds: Record<string, number>;
};

export type PendingPairingRequest = {
  requestId: string;
  deviceId: string;
  displayName?: string;
  platform?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  ts?: number;
};

function formatStringList(values?: readonly string[]): string {
  if (!Array.isArray(values) || values.length === 0) {
    return "none";
  }
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return normalized.length > 0 ? normalized.join(", ") : "none";
}

function formatRoleList(request: PendingPairingRequest): string {
  const role = request.role?.trim();
  if (role) {
    return role;
  }
  return formatStringList(request.roles);
}

function formatScopeList(request: PendingPairingRequest): string {
  return formatStringList(request.scopes);
}

export function formatPendingRequests(pending: PendingPairingRequest[]): string {
  if (pending.length === 0) {
    return "No pending device pairing requests.";
  }
  const lines: string[] = ["Pending device pairing requests:"];
  for (const req of pending) {
    const label = req.displayName?.trim() || req.deviceId;
    const platform = req.platform?.trim();
    const ip = req.remoteIp?.trim();
    const parts = [
      `- ${req.requestId}`,
      label ? `name=${label}` : null,
      platform ? `platform=${platform}` : null,
      `role=${formatRoleList(req)}`,
      `scopes=${formatScopeList(req)}`,
      ip ? `ip=${ip}` : null,
    ].filter(Boolean);
    lines.push(parts.join(" · "));
  }
  return lines.join("\n");
}

function resolveNotifyStatePath(stateDir: string): string {
  return path.join(stateDir, NOTIFY_STATE_FILE);
}

function normalizeNotifyState(raw: unknown): NotifyStateFile {
  const root = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const subscribersRaw = Array.isArray(root.subscribers) ? root.subscribers : [];
  const notifiedRaw =
    typeof root.notifiedRequestIds === "object" && root.notifiedRequestIds !== null
      ? (root.notifiedRequestIds as Record<string, unknown>)
      : {};

  const subscribers: NotifySubscription[] = [];
  for (const item of subscribersRaw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const to = typeof record.to === "string" ? record.to.trim() : "";
    if (!to) {
      continue;
    }
    const accountId =
      typeof record.accountId === "string" && record.accountId.trim()
        ? record.accountId.trim()
        : undefined;
    const messageThreadId =
      typeof record.messageThreadId === "string"
        ? record.messageThreadId.trim() || undefined
        : typeof record.messageThreadId === "number" && Number.isFinite(record.messageThreadId)
          ? Math.trunc(record.messageThreadId)
          : undefined;
    const mode = record.mode === "once" ? "once" : "persistent";
    const addedAtMs =
      typeof record.addedAtMs === "number" && Number.isFinite(record.addedAtMs)
        ? Math.trunc(record.addedAtMs)
        : Date.now();
    subscribers.push({
      to,
      accountId,
      messageThreadId,
      mode,
      addedAtMs,
    });
  }

  const notifiedRequestIds: Record<string, number> = {};
  for (const [requestId, ts] of Object.entries(notifiedRaw)) {
    if (!requestId.trim()) {
      continue;
    }
    if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) {
      continue;
    }
    notifiedRequestIds[requestId] = Math.trunc(ts);
  }

  return { subscribers, notifiedRequestIds };
}

async function readNotifyState(filePath: string): Promise<NotifyStateFile> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return normalizeNotifyState(JSON.parse(content));
  } catch {
    return { subscribers: [], notifiedRequestIds: {} };
  }
}

async function writeNotifyState(filePath: string, state: NotifyStateFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const content = JSON.stringify(state, null, 2);
  await fs.writeFile(filePath, `${content}\n`, "utf8");
}

function notifySubscriberKey(subscriber: {
  to: string;
  accountId?: string;
  messageThreadId?: string | number;
}): string {
  return [subscriber.to, subscriber.accountId ?? "", subscriber.messageThreadId ?? ""].join("|");
}

function buildPairingRequestNotificationText(request: PendingPairingRequest): string {
  const label = request.displayName?.trim() || request.deviceId;
  const platform = request.platform?.trim();
  const ip = request.remoteIp?.trim();
  const role = formatRoleList(request);
  const scopes = formatScopeList(request);
  const lines = [
    "📲 New device pairing request",
    `ID: ${request.requestId}`,
    `Name: ${label}`,
    ...(platform ? [`Platform: ${platform}`] : []),
    `Role: ${role}`,
    `Scopes: ${scopes}`,
    ...(ip ? [`IP: ${ip}`] : []),
    "",
    `Approve: /pair approve ${request.requestId}`,
    "List pending: /pair pending",
  ];
  return lines.join("\n");
}

function requestTimestampMs(request: PendingPairingRequest): number | null {
  if (typeof request.ts !== "number" || !Number.isFinite(request.ts)) {
    return null;
  }
  const ts = Math.trunc(request.ts);
  return ts > 0 ? ts : null;
}

function shouldNotifySubscriberForRequest(
  subscriber: NotifySubscription,
  request: PendingPairingRequest,
): boolean {
  if (subscriber.mode !== "once") {
    return true;
  }
  const ts = requestTimestampMs(request);
  // One-shot subscriptions should only notify for new requests created after arming.
  if (ts == null) {
    return false;
  }
  return ts >= subscriber.addedAtMs;
}

async function notifySubscriber(params: {
  api: CrawClawPluginApi;
  subscriber: NotifySubscription;
  text: string;
}): Promise<boolean> {
  void params;
  return false;
}

async function notifyPendingPairingRequests(params: {
  api: CrawClawPluginApi;
  statePath: string;
}): Promise<void> {
  const state = await readNotifyState(params.statePath);
  const pairing = await listDevicePairing();
  const pending = pairing.pending as PendingPairingRequest[];
  const now = Date.now();
  const pendingIds = new Set(pending.map((entry) => entry.requestId));
  let changed = false;

  for (const [requestId, ts] of Object.entries(state.notifiedRequestIds)) {
    if (!pendingIds.has(requestId) || now - ts > NOTIFY_MAX_SEEN_AGE_MS) {
      delete state.notifiedRequestIds[requestId];
      changed = true;
    }
  }

  if (state.subscribers.length > 0) {
    const oneShotDelivered = new Set<string>();
    for (const request of pending) {
      if (state.notifiedRequestIds[request.requestId]) {
        continue;
      }

      const text = buildPairingRequestNotificationText(request);
      let delivered = false;
      for (const subscriber of state.subscribers) {
        if (!shouldNotifySubscriberForRequest(subscriber, request)) {
          continue;
        }
        const sent = await notifySubscriber({
          api: params.api,
          subscriber,
          text,
        });
        delivered = delivered || sent;
        if (sent && subscriber.mode === "once") {
          oneShotDelivered.add(notifySubscriberKey(subscriber));
        }
      }

      if (delivered) {
        state.notifiedRequestIds[request.requestId] = now;
        changed = true;
      }
    }
    if (oneShotDelivered.size > 0) {
      const initialCount = state.subscribers.length;
      state.subscribers = state.subscribers.filter(
        (subscriber) => !oneShotDelivered.has(notifySubscriberKey(subscriber)),
      );
      if (state.subscribers.length !== initialCount) {
        changed = true;
      }
    }
  }

  if (changed) {
    await writeNotifyState(params.statePath, state);
  }
}

export async function armPairNotifyOnce(params: {
  api: CrawClawPluginApi;
  ctx: {
    channel: string;
    senderId?: string;
    from?: string;
    to?: string;
    accountId?: string;
    messageThreadId?: string | number;
  };
}): Promise<boolean> {
  void params;
  return true;
}

export async function handleNotifyCommand(params: {
  api: CrawClawPluginApi;
  ctx: {
    channel: string;
    senderId?: string;
    from?: string;
    to?: string;
    accountId?: string;
    messageThreadId?: string | number;
  };
  action: string;
}): Promise<{ text: string }> {
  void params;

  return { text: "Pairing notifications are unavailable until Rust-native channels are added." };
}

export function registerPairingNotifierService(api: CrawClawPluginApi): void {
  let notifyInterval: ReturnType<typeof setInterval> | null = null;

  api.registerService({
    id: "device-pair-notifier",
    start: async (ctx) => {
      const statePath = resolveNotifyStatePath(ctx.stateDir);
      const tick = async () => {
        await notifyPendingPairingRequests({ api, statePath });
      };

      await tick().catch((err) => {
        api.logger.warn(
          `device-pair: initial notify poll failed: ${String((err as Error)?.message ?? err)}`,
        );
      });

      notifyInterval = setInterval(() => {
        tick().catch((err) => {
          api.logger.warn(
            `device-pair: notify poll failed: ${String((err as Error)?.message ?? err)}`,
          );
        });
      }, NOTIFY_POLL_INTERVAL_MS);
      notifyInterval.unref?.();
    },
    stop: async () => {
      if (notifyInterval) {
        clearInterval(notifyInterval);
        notifyInterval = null;
      }
    },
  });
}
