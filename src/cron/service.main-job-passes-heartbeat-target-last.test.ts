import { describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";
import { setupCronServiceSuite, writeCronStoreSnapshot } from "./service.test-harness.js";
import type { CronJob } from "./types.js";

const { logger, makeStorePath } = setupCronServiceSuite({
  prefix: "cron-main-heartbeat-target",
});

type RunMainSessionOnce = NonNullable<
  ConstructorParameters<typeof CronService>[0]["runMainSessionOnce"]
>;

describe("cron main job passes main-session target=last", () => {
  function createMainCronJob(params: {
    now: number;
    id: string;
    wakeMode: CronJob["wakeMode"];
  }): CronJob {
    return {
      id: params.id,
      name: params.id,
      enabled: true,
      createdAtMs: params.now - 10_000,
      updatedAtMs: params.now - 10_000,
      schedule: { kind: "every", everyMs: 60_000 },
      sessionTarget: "main",
      wakeMode: params.wakeMode,
      payload: { kind: "systemEvent", text: "Check in" },
      state: { nextRunAtMs: params.now - 1 },
    };
  }

  function createCronWithSpies(params: {
    storePath: string;
    runMainSessionOnce: RunMainSessionOnce;
  }) {
    const enqueueSystemEvent = vi.fn();
    const requestMainSessionWake = vi.fn();
    const cron = new CronService({
      storePath: params.storePath,
      cronEnabled: true,
      log: logger,
      enqueueSystemEvent,
      requestMainSessionWake,
      runMainSessionOnce: params.runMainSessionOnce,
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    });
    return { cron, requestMainSessionWake };
  }

  async function runSingleTick(cron: CronService) {
    await cron.start();
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(1_000);
    cron.stop();
  }

  it("passes session.target=last to runMainSessionOnce for main jobs", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.now();

    const job = createMainCronJob({
      now,
      id: "test-main-delivery",
      wakeMode: "now",
    });

    await writeCronStoreSnapshot({ storePath, jobs: [job] });

    const runMainSessionOnce = vi.fn<RunMainSessionOnce>(async () => ({
      status: "ran" as const,
      durationMs: 50,
    }));

    const { cron } = createCronWithSpies({
      storePath,
      runMainSessionOnce,
    });

    await runSingleTick(cron);

    // runMainSessionOnce should have been called
    expect(runMainSessionOnce).toHaveBeenCalled();

    // The main-session override passed should include target: "last" so the
    // runner delivers the response to the last active channel.
    const callArgs = runMainSessionOnce.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs?.session).toBeDefined();
    expect(callArgs?.session?.target).toBe("last");
  });

  it("normalizes legacy now main jobs to the event-driven wake path", async () => {
    const { storePath } = await makeStorePath();
    const now = Date.now();

    const job = createMainCronJob({
      now,
      id: "test-now",
      wakeMode: "now",
    });

    await writeCronStoreSnapshot({ storePath, jobs: [job] });

    const runMainSessionOnce = vi.fn<RunMainSessionOnce>(async () => ({
      status: "ran" as const,
      durationMs: 50,
    }));

    const { cron, requestMainSessionWake } = createCronWithSpies({
      storePath,
      runMainSessionOnce,
    });

    await runSingleTick(cron);

    expect(requestMainSessionWake).not.toHaveBeenCalled();
    expect(runMainSessionOnce).toHaveBeenCalled();
    const callArgs = runMainSessionOnce.mock.calls[0]?.[0];
    expect(callArgs?.session?.target).toBe("last");
    const jobs = await cron.list({ includeDisabled: true });
    expect(jobs.find((entry) => entry.id === job.id)?.wakeMode).toBe("now");
  });
});
