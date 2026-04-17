import {
  isDeliverableMessageChannel,
  normalizeMessageChannel,
  type DeliverableMessageChannel,
} from "../utils/message-channel.js";

export type DeliverableTargetLike = {
  channel?: string | null;
  to?: string | null;
  accountId?: string | null;
  threadId?: string | number | null;
};

export type ResolvedDeliverableTarget = {
  channel: DeliverableMessageChannel;
  to: string;
  accountId?: string;
  threadId?: string | number;
};

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeDeliverableChannel(
  value?: string | null,
): DeliverableMessageChannel | undefined {
  const normalized = normalizeMessageChannel(value);
  return normalized && isDeliverableMessageChannel(normalized) ? normalized : undefined;
}

export function resolveDeliverableTarget(
  target?: DeliverableTargetLike | null,
): ResolvedDeliverableTarget | null {
  const channel = normalizeDeliverableChannel(target?.channel);
  const to = normalizeOptionalString(target?.to);
  if (!channel || !to) {
    return null;
  }
  return {
    channel,
    to,
    ...(normalizeOptionalString(target?.accountId)
      ? { accountId: normalizeOptionalString(target?.accountId) }
      : {}),
    ...(target?.threadId != null && target.threadId !== "" ? { threadId: target.threadId } : {}),
  };
}

export function buildDeliverableTargetKey(target: DeliverableTargetLike): string {
  const normalized = resolveDeliverableTarget(target);
  const channel =
    normalized?.channel ?? normalizeMessageChannel(target.channel) ?? target.channel ?? "";
  const to = normalized?.to ?? normalizeOptionalString(target.to) ?? "";
  const accountId = normalized?.accountId ?? normalizeOptionalString(target.accountId) ?? "";
  const threadId = normalized?.threadId ?? target.threadId ?? "";
  return [channel, to, accountId, threadId].join(":");
}
