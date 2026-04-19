import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.ts";

export type SessionDisplayLike = {
  key: string;
  kind?: string;
  chatType?: string;
  label?: string | null;
  displayName?: string | null;
  derivedTitle?: string | null;
  channel?: string | null;
  groupChannel?: string | null;
  surface?: string | null;
  subject?: string | null;
  room?: string | null;
  space?: string | null;
  sessionId?: string | null;
  origin?: {
    label?: string | null;
    provider?: string | null;
    surface?: string | null;
    chatType?: string | null;
    from?: string | null;
    to?: string | null;
    accountId?: string | null;
    threadId?: string | number | null;
  } | null;
};

type ParsedSessionRoute = {
  surface?: string;
  chatType?: string;
  peerId?: string;
};

const SURFACE_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
  signal: "Signal",
  imessage: "iMessage",
  googlechat: "Google Chat",
  webchat: "Web",
  feishu: "Feishu",
  matrix: "Matrix",
  teams: "Teams",
  direct: "Direct",
  group: "Group",
  global: "Global",
  unknown: "Session",
};

function parseSessionRoute(sessionKey: string | undefined | null): ParsedSessionRoute {
  const parsed = parseAgentSessionKey(sessionKey);
  const raw = parsed?.rest?.trim().toLowerCase();
  if (!raw) {
    return {};
  }
  const tokens = raw.split(":").filter(Boolean);
  const kindIndex = tokens.findIndex(
    (token) =>
      token === "direct" ||
      token === "group" ||
      token === "channel" ||
      token === "global" ||
      token === "unknown" ||
      token === "dm",
  );
  if (kindIndex === -1) {
    return {};
  }
  const chatType = tokens[kindIndex];
  const peerId = tokens[kindIndex + 1];
  const surface = kindIndex > 0 ? tokens[kindIndex - 1] : undefined;
  return {
    surface,
    chatType: chatType === "dm" ? "direct" : chatType,
    peerId,
  };
}

function looksOpaqueIdentity(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ||
    /^[a-z]{2,8}_[a-z0-9]+$/i.test(value) ||
    /^[+-]?\d{5,}$/.test(value)
  );
}

export function sessionSurfaceKey(session: SessionDisplayLike): string {
  const route = parseSessionRoute(session.key);
  return (
    route.surface ||
    session.channel ||
    session.groupChannel ||
    session.origin?.surface ||
    session.origin?.provider ||
    session.surface ||
    session.chatType ||
    session.kind ||
    "session"
  );
}

export function sessionSurfaceLabel(session: SessionDisplayLike): string {
  const raw = sessionSurfaceKey(session);
  const normalized = raw.trim().toLowerCase();
  return SURFACE_LABELS[normalized] ?? raw.trim() ?? "Session";
}

export function normalizeSessionIdentity(
  raw?: string | null,
  session?: SessionDisplayLike,
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const normalizedSurface = session ? sessionSurfaceKey(session).trim().toLowerCase() : undefined;
  let next = trimmed;
  if (normalizedSurface && next.toLowerCase().startsWith(`${normalizedSurface}:`)) {
    next = next.slice(normalizedSurface.length + 1).trim();
  }
  if (next.startsWith("g-") && next.length > 2) {
    next = next.slice(2);
  }
  if (looksOpaqueIdentity(next)) {
    return next;
  }
  next = next.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return next || null;
}

export function sessionIdentityLabel(session: SessionDisplayLike): string | null {
  const route = parseSessionRoute(session.key);
  const candidates = [
    session.origin?.label,
    session.origin?.from,
    session.subject,
    session.room,
    session.space,
    session.displayName,
    session.label,
    session.derivedTitle,
    route.peerId,
    session.sessionId,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeSessionIdentity(candidate, session);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function sessionDisplayName(session: SessionDisplayLike): string {
  const surface = sessionSurfaceLabel(session);
  const identity = sessionIdentityLabel(session);
  if (!identity) {
    return surface;
  }
  return identity.toLowerCase() === surface.toLowerCase() ? identity : `${surface} · ${identity}`;
}
