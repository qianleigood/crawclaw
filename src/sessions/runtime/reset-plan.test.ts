import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../../config/sessions/types.js";
import { planSessionReset } from "./reset-plan.js";

describe("planSessionReset", () => {
  const baseEntry = {
    sessionId: "session-existing",
    updatedAt: Date.now(),
  } as SessionEntry;

  it("triggers an explicit reset and strips the tail for /new commands", () => {
    const plan = planSessionReset({
      resetTriggers: ["/new"],
      resetAuthorized: true,
      trimmedBody: "/new summarize latest diff",
      strippedForReset: "/new summarize latest diff",
      shouldUseAcpInPlaceReset: false,
      entry: baseEntry,
      now: baseEntry.updatedAt,
      resetPolicy: { mode: "daily", atHour: 4 },
      isSystemEvent: false,
    });

    expect(plan).toMatchObject({
      resetTriggered: true,
      bodyStripped: "summarize latest diff",
      freshEntry: true,
      shouldReuseExistingSession: false,
    });
    expect(plan.previousSessionEntry).toEqual(baseEntry);
  });

  it("bypasses explicit reset rotation for ACP in-place default triggers", () => {
    const plan = planSessionReset({
      resetTriggers: ["/new"],
      resetAuthorized: true,
      trimmedBody: "/new",
      strippedForReset: "/new",
      shouldUseAcpInPlaceReset: true,
      entry: baseEntry,
      now: baseEntry.updatedAt,
      resetPolicy: { mode: "daily", atHour: 4 },
      isSystemEvent: false,
    });

    expect(plan).toMatchObject({
      resetTriggered: false,
      bodyStripped: undefined,
      freshEntry: true,
      shouldReuseExistingSession: true,
    });
    expect(plan.previousSessionEntry).toBeUndefined();
  });

  it("does not trigger explicit resets when reset is unauthorized", () => {
    const plan = planSessionReset({
      resetTriggers: ["/new"],
      resetAuthorized: false,
      trimmedBody: "/new",
      strippedForReset: "/new",
      shouldUseAcpInPlaceReset: false,
      entry: baseEntry,
      now: baseEntry.updatedAt,
      resetPolicy: { mode: "daily", atHour: 4 },
      isSystemEvent: false,
    });

    expect(plan).toMatchObject({
      resetTriggered: false,
      shouldReuseExistingSession: true,
      freshEntry: true,
    });
  });

  it("forces a fresh session when the existing entry is stale", () => {
    const updatedAt = new Date(2026, 0, 18, 3, 0, 0).getTime();
    const now = new Date(2026, 0, 18, 5, 0, 0).getTime();
    const plan = planSessionReset({
      resetTriggers: ["/new"],
      resetAuthorized: true,
      trimmedBody: "hello",
      strippedForReset: "hello",
      shouldUseAcpInPlaceReset: false,
      entry: {
        sessionId: "session-stale",
        updatedAt,
      } as SessionEntry,
      now,
      resetPolicy: { mode: "daily", atHour: 4 },
      isSystemEvent: false,
    });

    expect(plan).toMatchObject({
      resetTriggered: false,
      freshEntry: false,
      shouldReuseExistingSession: false,
    });
    expect(plan.previousSessionEntry).toEqual({
      sessionId: "session-stale",
      updatedAt,
    });
  });

  it("keeps stale entries fresh for heartbeat/cron/exec style system events", () => {
    const updatedAt = Date.now() - 10 * 60_000;
    const plan = planSessionReset({
      resetTriggers: ["/new"],
      resetAuthorized: true,
      trimmedBody: "heartbeat",
      strippedForReset: "heartbeat",
      shouldUseAcpInPlaceReset: false,
      entry: {
        sessionId: "session-system",
        updatedAt,
      } as SessionEntry,
      now: Date.now(),
      resetPolicy: { mode: "idle", atHour: 4, idleMinutes: 1 },
      isSystemEvent: true,
    });

    expect(plan).toMatchObject({
      resetTriggered: false,
      freshEntry: true,
      shouldReuseExistingSession: true,
    });
    expect(plan.previousSessionEntry).toBeUndefined();
  });
});
