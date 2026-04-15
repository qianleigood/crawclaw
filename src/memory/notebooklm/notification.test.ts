import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitNotebookLmNotification, resetNotebookLmNotificationsForTests } from "./notification.ts";

describe("emitNotebookLmNotification", () => {
  beforeEach(() => {
    resetNotebookLmNotificationsForTests();
  });

  it("emits degraded notification once within the throttle window", () => {
    const logger = { warn: vi.fn(), info: vi.fn() };
    const state = {
      enabled: true,
      ready: false,
      lifecycle: "expired" as const,
      reason: "auth_expired" as const,
      recommendedAction: "crawclaw memory login" as const,
      profile: "default",
      refreshAttempted: false,
      refreshSucceeded: false,
      lastValidatedAt: "2026-04-04T00:00:00.000Z",
    };

    expect(emitNotebookLmNotification({ state, logger, scope: { source: "query" } })).toBe(true);
    expect(emitNotebookLmNotification({ state, logger, scope: { source: "query" } })).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("crawclaw memory login"));
  });

  it("emits recovery notification independently from degraded notification", () => {
    const logger = { warn: vi.fn(), info: vi.fn() };
    const degraded = {
      enabled: true,
      ready: false,
      lifecycle: "expired" as const,
      reason: "auth_expired" as const,
      recommendedAction: "crawclaw memory login" as const,
      profile: "default",
      refreshAttempted: false,
      refreshSucceeded: false,
      lastValidatedAt: "2026-04-04T00:00:00.000Z",
    };
    const ready = {
      ...degraded,
      ready: true,
      lifecycle: "ready" as const,
      reason: null,
      recommendedAction: "crawclaw memory status" as const,
    };

    expect(emitNotebookLmNotification({ state: degraded, logger, scope: { source: "heartbeat" } })).toBe(true);
    expect(emitNotebookLmNotification({ state: ready, logger, scope: { source: "heartbeat" } })).toBe(true);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("NotebookLM 已恢复"));
  });
});
