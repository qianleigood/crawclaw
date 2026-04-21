import { afterEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { startHeartbeatRunner } from "./heartbeat-runner.js";
import {
  requestHeartbeatNow,
  resetHeartbeatWakeStateForTests,
  setHeartbeatsEnabled,
} from "./heartbeat-wake.js";

describe("startHeartbeatRunner", () => {
  type RunOnce = Parameters<typeof startHeartbeatRunner>[0]["runOnce"];

  function useFakeHeartbeatTime() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  }

  function startDefaultRunner(runOnce: RunOnce) {
    return startHeartbeatRunner({
      cfg: heartbeatConfig(),
      runOnce,
    });
  }

  function heartbeatConfig(
    list?: NonNullable<NonNullable<CrawClawConfig["agents"]>["list"]>,
  ): CrawClawConfig {
    return {
      agents: {
        defaults: { heartbeat: { every: "30m" } },
        ...(list ? { list } : {}),
      },
    } as CrawClawConfig;
  }

  function createRequestsInFlightRunSpy(skipCount: number) {
    let callCount = 0;
    return vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= skipCount) {
        return { status: "skipped", reason: "requests-in-flight" } as const;
      }
      return { status: "ran", durationMs: 1 } as const;
    });
  }

  async function expectWakeDispatch(params: {
    cfg: CrawClawConfig;
    runSpy: RunOnce;
    wake: { reason: string; agentId?: string; sessionKey?: string; coalesceMs: number };
    expectedCall: Record<string, unknown>;
  }) {
    const runner = startHeartbeatRunner({
      cfg: params.cfg,
      runOnce: params.runSpy,
    });

    requestHeartbeatNow(params.wake);
    await vi.advanceTimersByTimeAsync(1);

    expect(params.runSpy).toHaveBeenCalledTimes(1);
    expect(params.runSpy).toHaveBeenCalledWith(expect.objectContaining(params.expectedCall));

    return runner;
  }

  afterEach(() => {
    setHeartbeatsEnabled(true);
    resetHeartbeatWakeStateForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("updates scheduling when config changes without restart", async () => {
    useFakeHeartbeatTime();

    const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });

    const runner = startDefaultRunner(runSpy);

    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1_000);

    expect(runSpy).not.toHaveBeenCalled();

    runner.updateConfig({
      agents: {
        defaults: { heartbeat: { every: "30m" } },
        list: [
          { id: "main", heartbeat: { every: "10m" } },
          { id: "ops", heartbeat: { every: "15m" } },
        ],
      },
    } as CrawClawConfig);

    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);

    expect(runSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);

    expect(runSpy).not.toHaveBeenCalled();

    runner.stop();
  });

  it("keeps the wake handler active after runOnce throws an unhandled error", async () => {
    useFakeHeartbeatTime();

    let callCount = 0;
    const runSpy = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call throws (simulates crash during session compaction)
        throw new Error("session compaction error");
      }
      return { status: "ran", durationMs: 1 };
    });

    const runner = startDefaultRunner(runSpy);

    // First explicit wake fires and throws.
    requestHeartbeatNow({ reason: "hook:wake", coalesceMs: 0 });
    await vi.advanceTimersByTimeAsync(1);
    expect(runSpy).toHaveBeenCalledTimes(1);

    // A later explicit wake should still reach the handler.
    requestHeartbeatNow({ reason: "hook:wake", coalesceMs: 0 });
    await vi.advanceTimersByTimeAsync(1);
    expect(runSpy).toHaveBeenCalledTimes(2);

    runner.stop();
  });

  it("cleanup is idempotent and does not clear a newer runner's handler", async () => {
    useFakeHeartbeatTime();

    const runSpy1 = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
    const runSpy2 = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });

    const cfg = {
      agents: { defaults: { heartbeat: { every: "30m" } } },
    } as CrawClawConfig;

    // Start runner A
    const runnerA = startHeartbeatRunner({ cfg, runOnce: runSpy1 });

    // Start runner B (simulates lifecycle reload)
    const runnerB = startHeartbeatRunner({ cfg, runOnce: runSpy2 });

    // Stop runner A (stale cleanup) — should NOT kill runner B's handler
    runnerA.stop();

    // Runner B should still handle explicit wakes.
    requestHeartbeatNow({ reason: "hook:wake", coalesceMs: 0 });
    await vi.advanceTimersByTimeAsync(1);
    expect(runSpy2).toHaveBeenCalledTimes(1);
    expect(runSpy1).not.toHaveBeenCalled();

    // Double-stop should be safe (idempotent)
    runnerA.stop();

    runnerB.stop();
  });

  it("run() returns skipped when runner is stopped", async () => {
    useFakeHeartbeatTime();

    const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });

    const runner = startDefaultRunner(runSpy);

    runner.stop();

    // After stopping, no heartbeats should fire
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("retries explicit wakes when runOnce returns requests-in-flight", async () => {
    useFakeHeartbeatTime();

    const runSpy = createRequestsInFlightRunSpy(1);

    const runner = startHeartbeatRunner({
      cfg: heartbeatConfig(),
      runOnce: runSpy,
    });

    // First explicit wake returns requests-in-flight.
    requestHeartbeatNow({ reason: "hook:wake", coalesceMs: 0 });
    await vi.advanceTimersByTimeAsync(1);
    expect(runSpy).toHaveBeenCalledTimes(1);

    // The wake layer retries after DEFAULT_RETRY_MS (1 s).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runSpy).toHaveBeenCalledTimes(2);

    runner.stop();
  });

  it("does not create periodic interval runs after repeated requests-in-flight skips", async () => {
    useFakeHeartbeatTime();

    // Simulate a busy main lane: the first 5 calls return requests-in-flight,
    // then the 6th succeeds through wake-layer retries.
    const runSpy = createRequestsInFlightRunSpy(5);

    const runner = startHeartbeatRunner({
      cfg: heartbeatConfig(),
      runOnce: runSpy,
    });

    // Trigger the first explicit wake. It returns requests-in-flight.
    requestHeartbeatNow({ reason: "hook:wake", coalesceMs: 0 });
    await vi.advanceTimersByTimeAsync(1);
    expect(runSpy).toHaveBeenCalledTimes(1);

    // Four automatic wake-layer retries still see requests in flight.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(runSpy).toHaveBeenCalledTimes(5);

    // The final retry succeeds.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runSpy).toHaveBeenCalledTimes(6);

    // No legacy interval timer should be armed after the wake completes.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(runSpy).toHaveBeenCalledTimes(6);

    runner.stop();
  });

  it("routes targeted wake requests to the requested agent/session", async () => {
    useFakeHeartbeatTime();
    const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
    const runner = await expectWakeDispatch({
      cfg: {
        ...heartbeatConfig([
          { id: "main", heartbeat: { every: "30m" } },
          { id: "ops", heartbeat: { every: "15m" } },
        ]),
      } as CrawClawConfig,
      runSpy,
      wake: {
        reason: "cron:job-123",
        agentId: "ops",
        sessionKey: "agent:ops:discord:channel:alerts",
        coalesceMs: 0,
      },
      expectedCall: {
        agentId: "ops",
        reason: "cron:job-123",
        sessionKey: "agent:ops:discord:channel:alerts",
      },
    });

    runner.stop();
  });

  it("keeps explicit wake requests active when legacy heartbeats are runtime-disabled", async () => {
    useFakeHeartbeatTime();
    setHeartbeatsEnabled(false);

    const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
    const runner = await expectWakeDispatch({
      cfg: heartbeatConfig(),
      runSpy,
      wake: {
        reason: "background-task",
        sessionKey: "agent:main:main",
        coalesceMs: 0,
      },
      expectedCall: {
        agentId: "main",
        reason: "background-task",
        sessionKey: "agent:main:main",
      },
    });

    runner.stop();
  });

  it("does not fan out to unrelated agents for session-scoped exec wakes", async () => {
    useFakeHeartbeatTime();
    const runSpy = vi.fn().mockResolvedValue({ status: "ran", durationMs: 1 });
    const runner = await expectWakeDispatch({
      cfg: {
        ...heartbeatConfig([
          { id: "main", heartbeat: { every: "30m" } },
          { id: "finance", heartbeat: { every: "30m" } },
        ]),
      } as CrawClawConfig,
      runSpy,
      wake: {
        reason: "exec-event",
        sessionKey: "agent:main:main",
        coalesceMs: 0,
      },
      expectedCall: {
        agentId: "main",
        reason: "exec-event",
        sessionKey: "agent:main:main",
      },
    });
    expect(runSpy.mock.calls.some((call) => call[0]?.agentId === "finance")).toBe(false);

    runner.stop();
  });
});
