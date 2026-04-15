import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startNotebookLmHeartbeat, stopNotebookLmHeartbeatForTests } from "./heartbeat.ts";
import type { NotebookLmConfig } from "../types/config.ts";

describe("startNotebookLmHeartbeat", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  };

  const baseConfig: NotebookLmConfig = {
    enabled: true,
    auth: {
      profile: "default",
      cookieFile: "/tmp/notebooklm-cookies.txt",
      autoRefresh: true,
      statusTtlMs: 60_000,
      degradedCooldownMs: 120_000,
      refreshCooldownMs: 180_000,
      heartbeat: {
        enabled: true,
        minIntervalMs: 60_000,
        maxIntervalMs: 180_000,
      },
    },
    cli: {
      enabled: true,
      command: "python",
      args: ["/tmp/notebooklm-cli-recall.py", "{query}", "{limit}", "{notebookId}"],
      timeoutMs: 5_000,
      limit: 5,
      notebookId: "nb-1",
      queryInstruction: "",
    },
    write: {
      enabled: true,
      command: "python",
      args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
      timeoutMs: 5_000,
      notebookId: "nb-1",
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    logger.info.mockReset();
    logger.warn.mockReset();
    stopNotebookLmHeartbeatForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    stopNotebookLmHeartbeatForTests();
  });

  it("schedules randomized provider probes and does not duplicate identical heartbeats", async () => {
    const probe = vi.fn().mockResolvedValue({
      enabled: true,
      ready: true,
      reason: null,
      profile: "default",
      notebookId: "nb-1",
      refreshAttempted: false,
      refreshSucceeded: false,
      authSource: "profile",
      lastValidatedAt: new Date().toISOString(),
    });

    startNotebookLmHeartbeat({
      config: baseConfig,
      logger,
      probe,
    });
    startNotebookLmHeartbeat({
      config: baseConfig,
      logger,
      probe,
    });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(probe).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("logs degraded state and refresh outcome without throwing", async () => {
    const probe = vi.fn().mockResolvedValue({
      enabled: true,
      ready: false,
      reason: "auth_expired",
      profile: "default",
      notebookId: "nb-1",
      refreshAttempted: true,
      refreshSucceeded: false,
      authSource: "cookie_file",
      lastValidatedAt: new Date().toISOString(),
      details: "Authentication expired",
    });

    startNotebookLmHeartbeat({
      config: baseConfig,
      logger,
      probe,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("notebooklm auth heartbeat degraded"),
    );
  });
});
