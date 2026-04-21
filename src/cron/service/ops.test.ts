import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as taskExecutor from "../../tasks/task-executor.js";
import { findTaskByRunId, resetTaskRegistryForTests } from "../../tasks/task-registry.js";
import { setupCronServiceSuite, writeCronStoreSnapshot } from "../service.test-harness.js";
import type { CronJob } from "../types.js";
import { run, start, stop, wakeNow } from "./ops.js";
import { createCronServiceState } from "./state.js";

const { logger, makeStorePath } = setupCronServiceSuite({
  prefix: "cron-service-ops-seam",
});

function createInterruptedMainJob(now: number): CronJob {
  return {
    id: "startup-interrupted",
    name: "startup interrupted",
    enabled: true,
    createdAtMs: now - 86_400_000,
    updatedAtMs: now - 30 * 60_000,
    schedule: { kind: "cron", expr: "0 * * * *", tz: "UTC" },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: "should not replay on startup" },
    state: {
      nextRunAtMs: now - 60_000,
      runningAtMs: now - 30 * 60_000,
    },
  };
}

function createDueIsolatedJob(now: number): CronJob {
  return {
    id: "isolated-timeout",
    name: "isolated timeout",
    enabled: true,
    createdAtMs: now - 60_000,
    updatedAtMs: now - 60_000,
    schedule: { kind: "every", everyMs: 60_000, anchorMs: now - 60_000 },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: "do work" },
    sessionKey: "agent:main:main",
    state: { nextRunAtMs: now - 1 },
  };
}

function createMissedIsolatedJob(now: number): CronJob {
  return {
    id: "startup-timeout",
    name: "startup timeout",
    enabled: true,
    createdAtMs: now - 86_400_000,
    updatedAtMs: now - 30 * 60_000,
    schedule: { kind: "cron", expr: "0 * * * *", tz: "UTC" },
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payload: { kind: "agentTurn", message: "should timeout" },
    sessionKey: "agent:main:main",
    state: {
      nextRunAtMs: now - 60_000,
    },
  };
}

describe("cron service ops seam coverage", () => {
  it("treats next-heartbeat wake as an event-driven main-session wake", async () => {
    const { storePath } = await makeStorePath();
    const enqueueSystemEvent = vi.fn();
    const requestMainSessionWake = vi.fn();
    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      enqueueSystemEvent,
      requestMainSessionWake,
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    });

    const result = wakeNow(state, { mode: "next-heartbeat", text: "  check inbox  " });

    expect(result).toEqual({ ok: true });
    expect(enqueueSystemEvent).toHaveBeenCalledWith("check inbox");
    expect(requestMainSessionWake).toHaveBeenCalledWith({ reason: "wake" });
  });

  it("start clears stale running markers, skips startup replay, persists, and arms the timer", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const enqueueSystemEvent = vi.fn();
    const requestMainSessionWake = vi.fn();
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await writeCronStoreSnapshot({
      storePath,
      jobs: [createInterruptedMainJob(now)],
    });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent,
      requestMainSessionWake,
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    });

    await start(state);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "startup-interrupted" }),
      "cron: clearing stale running marker on startup",
    );
    expect(enqueueSystemEvent).not.toHaveBeenCalled();
    expect(requestMainSessionWake).not.toHaveBeenCalled();
    expect(state.timer).not.toBeNull();

    const persisted = JSON.parse(await fs.readFile(storePath, "utf8")) as {
      jobs: CronJob[];
    };
    const job = persisted.jobs[0];
    expect(job).toBeDefined();
    expect(job?.state.runningAtMs).toBeUndefined();
    expect(job?.state.lastStatus).toBeUndefined();
    expect((job?.state.nextRunAtMs ?? 0) > now).toBe(true);

    const delays = timeoutSpy.mock.calls
      .map(([, delay]) => delay)
      .filter((delay): delay is number => typeof delay === "number");
    expect(delays.some((delay) => delay > 0)).toBe(true);

    timeoutSpy.mockRestore();
    stop(state);
  });

  it("records timed out manual runs as timed_out in the shared task registry", async () => {
    const { storePath } = await makeStorePath();
    const stateRoot = path.dirname(path.dirname(storePath));
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const originalStateDir = process.env.CRAWCLAW_STATE_DIR;
    process.env.CRAWCLAW_STATE_DIR = stateRoot;
    resetTaskRegistryForTests();

    await writeCronStoreSnapshot({
      storePath,
      jobs: [createDueIsolatedJob(now)],
    });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestMainSessionWake: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => {
        throw new Error("cron: job execution timed out");
      }),
    });

    await run(state, "isolated-timeout");

    expect(findTaskByRunId(`cron:isolated-timeout:${now}`)).toMatchObject({
      runtime: "cron",
      status: "timed_out",
      sourceId: "isolated-timeout",
    });

    if (originalStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = originalStateDir;
    }
    resetTaskRegistryForTests();
  });

  it("keeps manual cron runs progressing when task ledger creation fails", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.parse("2026-03-23T12:00:00.000Z");

    await writeCronStoreSnapshot({
      storePath,
      jobs: [createDueIsolatedJob(now)],
    });

    const createTaskRecordSpy = vi
      .spyOn(taskExecutor, "createRunningTaskRun")
      .mockImplementation(() => {
        throw new Error("disk full");
      });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestMainSessionWake: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const, summary: "done" })),
    });

    await expect(run(state, "isolated-timeout")).resolves.toEqual({ ok: true, ran: true });

    const persisted = JSON.parse(await fs.readFile(storePath, "utf8")) as {
      jobs: CronJob[];
    };
    expect(persisted.jobs[0]?.state.runningAtMs).toBeUndefined();
    expect(persisted.jobs[0]?.state.lastStatus).toBe("ok");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "isolated-timeout" }),
      "cron: failed to create task ledger record",
    );

    createTaskRecordSpy.mockRestore();
  });

  it("keeps manual cron cleanup progressing when task ledger updates fail", async () => {
    const { storePath } = await makeStorePath();
    const stateRoot = path.dirname(path.dirname(storePath));
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const originalStateDir = process.env.CRAWCLAW_STATE_DIR;
    process.env.CRAWCLAW_STATE_DIR = stateRoot;
    resetTaskRegistryForTests();

    await writeCronStoreSnapshot({
      storePath,
      jobs: [createDueIsolatedJob(now)],
    });

    const updateTaskRecordSpy = vi
      .spyOn(taskExecutor, "completeTaskRunByRunId")
      .mockImplementation(() => {
        throw new Error("disk full");
      });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestMainSessionWake: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const, summary: "done" })),
    });

    await expect(run(state, "isolated-timeout")).resolves.toEqual({ ok: true, ran: true });

    const persisted = JSON.parse(await fs.readFile(storePath, "utf8")) as {
      jobs: CronJob[];
    };
    expect(persisted.jobs[0]?.state.runningAtMs).toBeUndefined();
    expect(persisted.jobs[0]?.state.lastStatus).toBe("ok");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobStatus: "ok" }),
      "cron: failed to update task ledger record",
    );

    updateTaskRecordSpy.mockRestore();
    if (originalStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = originalStateDir;
    }
    resetTaskRegistryForTests();
  });

  it("records startup catch-up timeouts as timed_out in the shared task registry", async () => {
    const { storePath } = await makeStorePath();
    const stateRoot = path.dirname(path.dirname(storePath));
    const now = Date.parse("2026-03-23T12:00:00.000Z");
    const originalStateDir = process.env.CRAWCLAW_STATE_DIR;
    process.env.CRAWCLAW_STATE_DIR = stateRoot;
    resetTaskRegistryForTests();

    await writeCronStoreSnapshot({
      storePath,
      jobs: [createMissedIsolatedJob(now)],
    });

    const state = createCronServiceState({
      storePath,
      cronEnabled: true,
      log: logger,
      nowMs: () => now,
      enqueueSystemEvent: vi.fn(),
      requestMainSessionWake: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => {
        throw new Error("cron: job execution timed out");
      }),
    });

    await start(state);

    expect(findTaskByRunId(`cron:startup-timeout:${now}`)).toMatchObject({
      runtime: "cron",
      status: "timed_out",
      sourceId: "startup-timeout",
    });

    if (originalStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = originalStateDir;
    }
    resetTaskRegistryForTests();
    stop(state);
  });
});
