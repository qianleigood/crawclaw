import { DEFAULT_RESET_TRIGGERS, type SessionEntry } from "../../config/sessions/types.js";

export type SessionResetPolicy =
  | { mode: "never" }
  | { mode: "always" }
  | { mode: "idle"; idleMinutes: number };

function evaluateSessionFreshness(params: {
  updatedAt?: number;
  now: number;
  policy: SessionResetPolicy;
}): { fresh: boolean } {
  if (params.policy.mode === "always") {
    return { fresh: false };
  }
  if (params.policy.mode === "never") {
    return { fresh: true };
  }
  const updatedAt = typeof params.updatedAt === "number" ? params.updatedAt : 0;
  const idleMs = params.policy.idleMinutes * 60_000;
  return { fresh: params.now - updatedAt < idleMs };
}

export type SessionResetPlan = {
  resetTriggered: boolean;
  bodyStripped?: string;
  freshEntry: boolean;
  shouldReuseExistingSession: boolean;
  previousSessionEntry?: SessionEntry;
};

export function planSessionReset(params: {
  resetTriggers: string[];
  resetAuthorized: boolean;
  trimmedBody: string;
  strippedForReset: string;
  shouldUseAcpInPlaceReset: boolean;
  entry?: SessionEntry;
  now: number;
  resetPolicy: SessionResetPolicy;
  isSystemEvent: boolean;
}): SessionResetPlan {
  let resetTriggered = false;
  let bodyStripped: string | undefined;

  const trimmedBodyLower = params.trimmedBody.toLowerCase();
  const strippedForResetLower = params.strippedForReset.toLowerCase();
  const shouldBypassAcpResetForTrigger = (triggerLower: string): boolean =>
    params.shouldUseAcpInPlaceReset &&
    DEFAULT_RESET_TRIGGERS.some((defaultTrigger) => defaultTrigger.toLowerCase() === triggerLower);

  for (const trigger of params.resetTriggers) {
    if (!trigger) {
      continue;
    }
    if (!params.resetAuthorized) {
      break;
    }
    const triggerLower = trigger.toLowerCase();
    if (trimmedBodyLower === triggerLower || strippedForResetLower === triggerLower) {
      if (shouldBypassAcpResetForTrigger(triggerLower)) {
        break;
      }
      resetTriggered = true;
      bodyStripped = "";
      break;
    }
    const triggerPrefixLower = `${triggerLower} `;
    if (
      trimmedBodyLower.startsWith(triggerPrefixLower) ||
      strippedForResetLower.startsWith(triggerPrefixLower)
    ) {
      if (shouldBypassAcpResetForTrigger(triggerLower)) {
        break;
      }
      resetTriggered = true;
      bodyStripped = params.strippedForReset.slice(trigger.length).trimStart();
      break;
    }
  }

  const freshEntry = params.entry
    ? params.isSystemEvent
      ? true
      : evaluateSessionFreshness({
          updatedAt: params.entry.updatedAt,
          now: params.now,
          policy: params.resetPolicy,
        }).fresh
    : false;
  const shouldReuseExistingSession = Boolean(params.entry) && !resetTriggered && freshEntry;

  return {
    resetTriggered,
    bodyStripped,
    freshEntry,
    shouldReuseExistingSession,
    previousSessionEntry:
      (resetTriggered || !freshEntry) && params.entry ? { ...params.entry } : undefined,
  };
}
