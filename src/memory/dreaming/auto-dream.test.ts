import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDurableMemoryScope } from "../durable/scope.js";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { writeSessionSummaryFile } from "../session-summary/store.ts";
import { AutoDreamScheduler, __testing } from "./auto-dream.js";

function asRuntimeStore(store: Partial<RuntimeStore>): RuntimeStore {
  return store as RuntimeStore;
}

describe("AutoDreamScheduler", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    __testing.resetSharedAutoDreamScheduler();
  });

  afterEach(() => {
    return Promise.all(
      tempDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })),
    ).finally(() => {
      delete process.env.CRAWCLAW_STATE_DIR;
      __testing.resetSharedAutoDreamScheduler();
    });
  });

  it("skips when min-session gate is not met and records an attempt", async () => {
    const touchDreamAttempt = vi.fn().mockResolvedValue(undefined);
    const acquireDreamLock = vi.fn();
    const runtimeStore = asRuntimeStore({
      getDreamState: vi.fn().mockResolvedValue(null),
      listScopedSessionIdsTouchedSince: vi.fn().mockResolvedValue(["s1"]),
      touchDreamAttempt,
      acquireDreamLock,
    });

    const scheduler = new AutoDreamScheduler({
      config: {
        enabled: true,
        minHours: 24,
        minSessions: 5,
        scanThrottleMs: 600_000,
        lockStaleAfterMs: 3_600_000,
      },
      runtimeStore,
      runner: vi.fn(),
      logger: console,
    });

    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    expect(scope).not.toBeNull();

    const result = await scheduler.runNow({
      scope: scope!,
      triggerSource: "stop",
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "min_sessions_gate",
    });
    expect(touchDreamAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "min_sessions_gate" }),
    );
    expect(acquireDreamLock).not.toHaveBeenCalled();
  });

  it("acquires the runtime DB lock and records a maintenance run around consolidation", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await Promise.all(
      ["s1", "s2", "s3", "s4", "s5"].map(async (sessionId) => {
        await writeSessionSummaryFile({
          agentId: "main",
          sessionId,
          content: `# Session Summary\n\n## Current State\nsummary:${sessionId}\n`,
        });
      }),
    );
    const runner = vi.fn().mockResolvedValue({
      status: "written",
      summary: "merged duplicate feedback notes",
      writtenCount: 1,
      updatedCount: 2,
      deletedCount: 1,
    });
    const acquireDreamLock = vi.fn().mockResolvedValue({
      acquired: true,
      state: {
        scopeKey: "main:feishu:user-1",
        lastSuccessAt: null,
        lastAttemptAt: Date.now(),
        lastFailureAt: null,
        lockOwner: "dream-1",
        lockAcquiredAt: Date.now(),
        lastRunId: null,
        updatedAt: Date.now(),
      },
    });
    const createMaintenanceRun = vi.fn().mockResolvedValue("mrun-1");
    const releaseDreamLock = vi.fn().mockResolvedValue(undefined);
    const runtimeStore = asRuntimeStore({
      getDreamState: vi.fn().mockResolvedValue({
        scopeKey: "main:feishu:user-1",
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastFailureAt: null,
        lockOwner: null,
        lockAcquiredAt: null,
        lastRunId: null,
        updatedAt: Date.now(),
      }),
      listScopedSessionIdsTouchedSince: vi.fn().mockResolvedValue(["s1", "s2", "s3", "s4", "s5"]),
      touchDreamAttempt: vi.fn().mockResolvedValue(undefined),
      acquireDreamLock,
      createMaintenanceRun,
      listRecentContextArchiveRuns: vi.fn().mockResolvedValue([]),
      listContextArchiveEvents: vi.fn().mockResolvedValue([]),
      listRecentMaintenanceRuns: vi.fn().mockResolvedValue([]),
      getSessionSummaryState: vi.fn().mockResolvedValue({
        lastSummarizedMessageId: "msg-1",
        lastSummaryUpdatedAt: Date.now(),
        tokensAtLastSummary: 120,
        summaryInProgress: false,
      }),
      updateMaintenanceRun: vi.fn().mockResolvedValue(undefined),
      releaseDreamLock,
    });

    const scheduler = new AutoDreamScheduler({
      config: {
        enabled: true,
        minHours: 24,
        minSessions: 5,
        scanThrottleMs: 600_000,
        lockStaleAfterMs: 3_600_000,
      },
      runtimeStore,
      runner,
      logger: console,
    });

    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    expect(scope).not.toBeNull();

    const result = await scheduler.runNow({
      scope: scope!,
      parentRunId: "parent-run-1",
      triggerSource: "manual_cli",
      bypassGate: true,
    });

    expect(result.status).toBe("started");
    expect(acquireDreamLock).toHaveBeenCalledTimes(1);
    expect(createMaintenanceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "dream",
        status: "running",
        scope: scope!.scopeKey,
        triggerSource: "manual_cli",
      }),
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "mrun-1",
        parentRunId: "parent-run-1",
        scope,
        recentSignals: expect.any(Array),
      }),
      console,
    );
    expect(releaseDreamLock).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKey: scope!.scopeKey,
        runId: "mrun-1",
        status: "succeeded",
      }),
    );
  });

  it("supports dry-run preview without acquiring the lock or spawning consolidation", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-dry-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await Promise.all(
      ["s1", "s2", "s3", "s4", "s5"].map(async (sessionId) => {
        await writeSessionSummaryFile({
          agentId: "main",
          sessionId,
          content: `# Session Summary\n\n## Current State\nsummary:${sessionId}\n`,
        });
      }),
    );
    const runner = vi.fn();
    const acquireDreamLock = vi.fn();
    const runtimeStore = asRuntimeStore({
      getDreamState: vi.fn().mockResolvedValue(null),
      listScopedSessionIdsTouchedSince: vi.fn().mockResolvedValue(["s1", "s2", "s3", "s4", "s5"]),
      touchDreamAttempt: vi.fn().mockResolvedValue(undefined),
      acquireDreamLock,
      listRecentContextArchiveRuns: vi.fn().mockResolvedValue([]),
      listContextArchiveEvents: vi.fn().mockResolvedValue([]),
      listRecentMaintenanceRuns: vi.fn().mockResolvedValue([]),
      getSessionSummaryState: vi.fn().mockResolvedValue({
        lastSummarizedMessageId: "msg-1",
        lastSummaryUpdatedAt: Date.now(),
        tokensAtLastSummary: 120,
        summaryInProgress: false,
      }),
    });

    const scheduler = new AutoDreamScheduler({
      config: {
        enabled: true,
        minHours: 24,
        minSessions: 5,
        scanThrottleMs: 600_000,
        lockStaleAfterMs: 3_600_000,
      },
      runtimeStore,
      runner,
      logger: console,
    });

    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    expect(scope).not.toBeNull();

    const result = await scheduler.runNow({
      scope: scope!,
      triggerSource: "manual_cli",
      bypassGate: true,
      dryRun: true,
      sessionLimit: 3,
      signalLimit: 2,
    });

    expect(result.status).toBe("preview");
    expect(result.preview?.recentSessionIds).toEqual(["s1", "s2", "s3"]);
    expect(acquireDreamLock).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });
});
