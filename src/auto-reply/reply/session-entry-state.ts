import { resolveLastChannelRaw, resolveLastToRaw } from "../../channels/session-delivery-route.js";
import { deriveSessionMetaPatch } from "../../config/sessions/metadata.js";
import type { GroupKeyResolution, SessionEntry } from "../../config/sessions/types.js";
import { normalizeSessionDeliveryFields } from "../../utils/delivery-context.js";
import type { MsgContext } from "../templating.js";

export function buildSessionEntryState(params: {
  ctx: MsgContext;
  sessionKey: string;
  groupResolution?: GroupKeyResolution;
  baseEntry?: SessionEntry;
  resetCarryOver?: Partial<SessionEntry>;
  sessionId: string;
  systemSent: boolean;
  abortedLastRun: boolean;
  now?: number;
  isThread: boolean;
}): SessionEntry {
  const baseEntry = params.baseEntry;
  const originatingChannelRaw = params.ctx.OriginatingChannel as string | undefined;
  const lastChannelRaw = resolveLastChannelRaw({
    originatingChannelRaw,
    persistedLastChannel: baseEntry?.lastChannel,
    sessionKey: params.sessionKey,
  });
  const lastToRaw = resolveLastToRaw({
    originatingChannelRaw,
    originatingToRaw: params.ctx.OriginatingTo,
    toRaw: params.ctx.To,
    persistedLastTo: baseEntry?.lastTo,
    persistedLastChannel: baseEntry?.lastChannel,
    sessionKey: params.sessionKey,
  });
  const lastAccountIdRaw = params.ctx.AccountId || baseEntry?.lastAccountId;
  const lastThreadIdRaw =
    params.ctx.MessageThreadId || (params.isThread ? baseEntry?.lastThreadId : undefined);
  const deliveryFields = normalizeSessionDeliveryFields({
    deliveryContext: {
      channel: lastChannelRaw,
      to: lastToRaw,
      accountId: lastAccountIdRaw,
      threadId: lastThreadIdRaw,
    },
  });
  const lastChannel = deliveryFields.lastChannel ?? lastChannelRaw;
  const lastTo = deliveryFields.lastTo ?? lastToRaw;
  const lastAccountId = deliveryFields.lastAccountId ?? lastAccountIdRaw;
  const lastThreadId = deliveryFields.lastThreadId ?? lastThreadIdRaw;

  let sessionEntry: SessionEntry = {
    ...baseEntry,
    ...params.resetCarryOver,
    sessionId: params.sessionId,
    updatedAt: params.now ?? Date.now(),
    systemSent: params.systemSent,
    abortedLastRun: params.abortedLastRun,
    responseUsage: baseEntry?.responseUsage,
    sendPolicy: baseEntry?.sendPolicy,
    queueMode: baseEntry?.queueMode,
    queueDebounceMs: baseEntry?.queueDebounceMs,
    queueCap: baseEntry?.queueCap,
    queueDrop: baseEntry?.queueDrop,
    chatType: baseEntry?.chatType,
    channel: baseEntry?.channel,
    groupId: baseEntry?.groupId,
    subject: baseEntry?.subject,
    groupChannel: baseEntry?.groupChannel,
    space: baseEntry?.space,
    deliveryContext: deliveryFields.deliveryContext,
    lastChannel,
    lastTo,
    lastAccountId,
    lastThreadId,
  };
  const metaPatch = deriveSessionMetaPatch({
    ctx: params.ctx,
    sessionKey: params.sessionKey,
    existing: sessionEntry,
    groupResolution: params.groupResolution,
  });
  if (metaPatch) {
    sessionEntry = { ...sessionEntry, ...metaPatch };
  }
  if (!sessionEntry.chatType) {
    sessionEntry.chatType = "direct";
  }
  const threadLabel = params.ctx.ThreadLabel?.trim();
  if (threadLabel) {
    sessionEntry.displayName = threadLabel;
  }
  return sessionEntry;
}
