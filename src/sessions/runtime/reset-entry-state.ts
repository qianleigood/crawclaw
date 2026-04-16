import { randomUUID } from "node:crypto";
import type { SessionEntry } from "../../config/sessions/types.js";
import { pickResetCarryOverFields } from "./reset-carry-over.js";
import type { SessionResetPlan } from "./reset-plan.js";

export type SessionResetEntryState = {
  sessionId: string;
  isNewSession: boolean;
  systemSent: boolean;
  abortedLastRun: boolean;
  baseEntry?: SessionEntry;
  resetCarryOver?: Partial<SessionEntry>;
};

export function resolveSessionResetEntryState(params: {
  entry?: SessionEntry;
  resetPlan: Pick<SessionResetPlan, "shouldReuseExistingSession" | "resetTriggered">;
  createSessionId?: () => string;
}): SessionResetEntryState {
  if (params.resetPlan.shouldReuseExistingSession && params.entry) {
    return {
      sessionId: params.entry.sessionId,
      isNewSession: false,
      systemSent: params.entry.systemSent ?? false,
      abortedLastRun: params.entry.abortedLastRun ?? false,
      baseEntry: params.entry,
      resetCarryOver: undefined,
    };
  }

  return {
    sessionId: params.createSessionId ? params.createSessionId() : randomUUID(),
    isNewSession: true,
    systemSent: false,
    abortedLastRun: false,
    baseEntry: undefined,
    resetCarryOver:
      params.resetPlan.resetTriggered && params.entry
        ? pickResetCarryOverFields(params.entry, "command-reset")
        : undefined,
  };
}
