import type { MediaUnderstandingScopeConfig } from "../config/types.tools.js";

export type MediaUnderstandingScopeDecision = "allow" | "deny";

function normalizeDecision(value?: string | null): MediaUnderstandingScopeDecision | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "allow" || normalized === "deny" ? normalized : undefined;
}

function normalizeMatch(value?: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function normalizeMediaUnderstandingChatType(raw?: string | null): string | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "dm") {
    return "direct";
  }
  return normalized === "direct" ||
    normalized === "group" ||
    normalized === "channel" ||
    normalized === "thread"
    ? normalized
    : undefined;
}

export function resolveMediaUnderstandingScope(params: {
  scope?: MediaUnderstandingScopeConfig;
  sessionKey?: string;
  channel?: string;
  chatType?: string;
}): MediaUnderstandingScopeDecision {
  const scope = params.scope;
  if (!scope) {
    return "allow";
  }
  const channel = normalizeMatch(params.channel);
  const chatType = normalizeMediaUnderstandingChatType(params.chatType);
  const sessionKey = normalizeMatch(params.sessionKey) ?? "";

  for (const rule of scope.rules ?? []) {
    if (!rule) {
      continue;
    }
    const action = normalizeDecision(rule.action) ?? "allow";
    const match = rule.match ?? {};
    const matchChannel = normalizeMatch(match.channel);
    const matchChatType = normalizeMediaUnderstandingChatType(match.chatType);
    const matchPrefix = normalizeMatch(match.keyPrefix);
    if (matchChannel && matchChannel !== channel) {
      continue;
    }
    if (matchChatType && matchChatType !== chatType) {
      continue;
    }
    if (matchPrefix && !sessionKey.startsWith(matchPrefix)) {
      continue;
    }
    return action;
  }

  return normalizeDecision(scope.default) ?? "allow";
}
