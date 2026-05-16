import type { MsgContext } from "../../auto-reply/templating.js";
import { normalizeMessageChannel } from "../../utils/gateway-client-surface.js";
import { resolveGroupSessionKey } from "./group.js";
import type { GroupKeyResolution, SessionEntry, SessionOrigin } from "./types.js";

function normalizeChatType(raw?: string | null): SessionOrigin["chatType"] | undefined {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "direct" ||
    normalized === "group" ||
    normalized === "channel" ||
    normalized === "thread" ||
    normalized === "room"
    ? normalized
    : undefined;
}

function mergeOrigin(
  existing: SessionOrigin | undefined,
  next: SessionOrigin | undefined,
): SessionOrigin | undefined {
  if (!existing) {
    return next;
  }
  if (!next) {
    return existing;
  }
  const merged = { ...existing, ...next };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function deriveSessionOrigin(ctx: MsgContext): SessionOrigin | undefined {
  const providerRaw =
    (typeof ctx.OriginatingChannel === "string" && ctx.OriginatingChannel) ||
    ctx.Surface ||
    ctx.Provider;
  const provider = normalizeMessageChannel(providerRaw);
  const surface = ctx.Surface?.trim().toLowerCase();
  const chatType = normalizeChatType(ctx.ChatType);
  const from = ctx.From?.trim();
  const to =
    (typeof ctx.OriginatingTo === "string" ? ctx.OriginatingTo : ctx.To)?.trim() ?? undefined;
  const accountId = ctx.AccountId?.trim();
  const threadId = ctx.MessageThreadId ?? undefined;

  const origin: SessionOrigin = {};
  if (provider) {
    origin.provider = provider;
  }
  if (surface) {
    origin.surface = surface;
  }
  if (chatType) {
    origin.chatType = chatType;
  }
  if (from) {
    origin.from = from;
  }
  if (to) {
    origin.to = to;
  }
  if (accountId) {
    origin.accountId = accountId;
  }
  if (threadId != null && threadId !== "") {
    origin.threadId = threadId;
  }

  return Object.keys(origin).length > 0 ? origin : undefined;
}

export function snapshotSessionOrigin(entry?: SessionEntry): SessionOrigin | undefined {
  return entry?.origin ? { ...entry.origin } : undefined;
}

export function deriveGroupSessionPatch(params: {
  ctx: MsgContext;
  sessionKey: string;
  existing?: SessionEntry;
  groupResolution?: GroupKeyResolution | null;
}): Partial<SessionEntry> | null {
  const resolution = params.groupResolution ?? resolveGroupSessionKey(params.ctx);
  if (!resolution?.channel) {
    return null;
  }
  const subject = params.ctx.GroupSubject?.trim();
  const space = params.ctx.GroupSpace?.trim();
  const patch: Partial<SessionEntry> = {
    chatType: resolution.chatType ?? "group",
    channel: resolution.channel,
    groupId: resolution.id,
  };
  if (subject) {
    patch.subject = subject;
    patch.displayName = subject;
  } else {
    patch.displayName = params.existing?.displayName ?? resolution.id ?? params.sessionKey;
  }
  if (space) {
    patch.space = space;
  }
  return patch;
}

export function deriveSessionMetaPatch(params: {
  ctx: MsgContext;
  sessionKey: string;
  existing?: SessionEntry;
  groupResolution?: GroupKeyResolution | null;
}): Partial<SessionEntry> | null {
  const groupPatch = deriveGroupSessionPatch(params);
  const origin = deriveSessionOrigin(params.ctx);
  if (!groupPatch && !origin) {
    return null;
  }
  const patch: Partial<SessionEntry> = groupPatch ? { ...groupPatch } : {};
  const mergedOrigin = mergeOrigin(params.existing?.origin, origin);
  if (mergedOrigin) {
    const subject = groupPatch?.subject?.trim();
    const groupId = groupPatch?.groupId?.trim();
    if (!mergedOrigin.label && subject && groupId) {
      mergedOrigin.label = `${subject} id:${groupId}`;
    }
    patch.origin = mergedOrigin;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
