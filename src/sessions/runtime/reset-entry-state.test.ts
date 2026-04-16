import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";
import { resolveSessionResetEntryState } from "./reset-entry-state.js";

describe("resolveSessionResetEntryState", () => {
  it("reuses the existing session when the reset plan keeps the current session", () => {
    const entry = {
      sessionId: "session-existing",
      updatedAt: 1_700_000_000_000,
      systemSent: true,
      abortedLastRun: true,
    } as SessionEntry;

    const result = resolveSessionResetEntryState({
      entry,
      resetPlan: {
        shouldReuseExistingSession: true,
        resetTriggered: false,
      },
      createSessionId: () => "session-new",
    });

    expect(result).toEqual({
      sessionId: "session-existing",
      isNewSession: false,
      systemSent: true,
      abortedLastRun: true,
      baseEntry: entry,
      resetCarryOver: undefined,
    });
  });

  it("allocates a fresh session and carries reset fields only for explicit resets", () => {
    const entry = {
      sessionId: "session-existing",
      updatedAt: 1_700_000_000_000,
      thinkingLevel: "high",
      fastMode: true,
      verboseLevel: "full",
      label: "Pinned",
    } as SessionEntry;

    const result = resolveSessionResetEntryState({
      entry,
      resetPlan: {
        shouldReuseExistingSession: false,
        resetTriggered: true,
      },
      createSessionId: () => "session-new",
    });

    expect(result).toMatchObject({
      sessionId: "session-new",
      isNewSession: true,
      systemSent: false,
      abortedLastRun: false,
      baseEntry: undefined,
      resetCarryOver: {
        thinkingLevel: "high",
        verboseLevel: "full",
        label: "Pinned",
      },
    });
  });

  it("does not carry explicit reset fields for stale-session rollover", () => {
    const entry = {
      sessionId: "session-existing",
      updatedAt: 1_700_000_000_000,
      thinkingLevel: "high",
      verboseLevel: "full",
    } as SessionEntry;

    const result = resolveSessionResetEntryState({
      entry,
      resetPlan: {
        shouldReuseExistingSession: false,
        resetTriggered: false,
      },
      createSessionId: () => "session-new",
    });

    expect(result).toEqual({
      sessionId: "session-new",
      isNewSession: true,
      systemSent: false,
      abortedLastRun: false,
      baseEntry: undefined,
      resetCarryOver: undefined,
    });
  });
});
