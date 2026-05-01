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
      touchedNotes: ["feedback/answer-style.md", "project/gateway-recovery.md"],
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
    const updateMaintenanceRun = vi.fn().mockResolvedValue(undefined);
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
      updateMaintenanceRun,
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
    expect(updateMaintenanceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mrun-1",
        metricsJson: expect.any(String),
      }),
    );
    const finalMetricsJson = updateMaintenanceRun.mock.calls.at(-1)?.[0]?.metricsJson;
    expect(typeof finalMetricsJson).toBe("string");
    expect(JSON.parse(String(finalMetricsJson))).toMatchObject({
      touchedNotes: ["feedback/answer-style.md", "project/gateway-recovery.md"],
    });
    expect(releaseDreamLock).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKey: scope!.scopeKey,
        runId: "mrun-1",
        status: "succeeded",
      }),
    );
  });

  it("finishes on the original runtime store if a nested runtime reconfigures the shared scheduler", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-reconfig-"));
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

    const updateMaintenanceRun = vi.fn().mockResolvedValue(undefined);
    const releaseDreamLock = vi.fn().mockResolvedValue(undefined);
    const originalStore = asRuntimeStore({
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
      acquireDreamLock: vi.fn().mockResolvedValue({
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
      }),
      createMaintenanceRun: vi.fn().mockResolvedValue("mrun-original"),
      listRecentContextArchiveRuns: vi.fn().mockResolvedValue([]),
      listContextArchiveEvents: vi.fn().mockResolvedValue([]),
      listRecentMaintenanceRuns: vi.fn().mockResolvedValue([]),
      getSessionSummaryState: vi.fn().mockResolvedValue({
        lastSummarizedMessageId: "msg-1",
        lastSummaryUpdatedAt: Date.now(),
        tokensAtLastSummary: 120,
        summaryInProgress: false,
      }),
      updateMaintenanceRun,
      releaseDreamLock,
    });
    const nestedUpdateMaintenanceRun = vi.fn().mockResolvedValue(undefined);
    const nestedReleaseDreamLock = vi.fn().mockResolvedValue(undefined);
    const nestedStore = asRuntimeStore({
      updateMaintenanceRun: nestedUpdateMaintenanceRun,
      releaseDreamLock: nestedReleaseDreamLock,
    });

    let scheduler: AutoDreamScheduler;
    const runner = vi.fn().mockImplementation(async () => {
      scheduler.reconfigure({
        config: {
          enabled: true,
          minHours: 24,
          minSessions: 5,
          scanThrottleMs: 600_000,
          lockStaleAfterMs: 3_600_000,
        },
        runtimeStore: nestedStore,
        runner: vi.fn(),
        logger: console,
      });
      return {
        status: "written",
        summary: "merged duplicate feedback notes",
        writtenCount: 0,
        updatedCount: 1,
        deletedCount: 1,
        touchedNotes: ["feedback/answer-style.md"],
      };
    });

    scheduler = new AutoDreamScheduler({
      config: {
        enabled: true,
        minHours: 24,
        minSessions: 5,
        scanThrottleMs: 600_000,
        lockStaleAfterMs: 3_600_000,
      },
      runtimeStore: originalStore,
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
    });

    expect(result.status).toBe("started");
    expect(updateMaintenanceRun).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mrun-original",
        status: "done",
      }),
    );
    expect(releaseDreamLock).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKey: scope!.scopeKey,
        runId: "mrun-original",
        status: "succeeded",
      }),
    );
    expect(nestedUpdateMaintenanceRun).not.toHaveBeenCalled();
    expect(nestedReleaseDreamLock).not.toHaveBeenCalled();
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

  it("compacts session summaries before passing them to the dream runner", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-compact-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const longBody = `${"stable durable signal ".repeat(2_000)}tail-marker-should-not-survive`;
    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "s1",
      content: `# Session Summary\n\n## Current State\n${longBody}\n\n## Key Results\nfinal result\n`,
    });
    const runtimeStore = asRuntimeStore({
      getDreamState: vi.fn().mockResolvedValue(null),
      listScopedSessionIdsTouchedSince: vi.fn().mockResolvedValue(["s1"]),
      touchDreamAttempt: vi.fn().mockResolvedValue(undefined),
      acquireDreamLock: vi.fn(),
      listRecentContextArchiveRuns: vi.fn().mockResolvedValue([]),
      listContextArchiveEvents: vi.fn().mockResolvedValue([]),
      listRecentMaintenanceRuns: vi.fn().mockResolvedValue([]),
      getSessionSummaryState: vi.fn().mockResolvedValue({
        lastSummarizedMessageId: "msg-1",
        lastSummaryUpdatedAt: Date.now(),
        tokensAtLastSummary: 8_000,
        summaryInProgress: false,
      }),
    });

    const scheduler = new AutoDreamScheduler({
      config: {
        enabled: true,
        minHours: 24,
        minSessions: 1,
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
      triggerSource: "manual_cli",
      bypassGate: true,
      dryRun: true,
    });

    const summaryText = result.preview?.sessionSummaries[0]?.summaryText ?? "";
    expect(summaryText).toContain("[truncated to fit compact summary budget]");
    expect(summaryText).not.toContain("tail-marker-should-not-survive");
  });

  it("uses compact summary state when the session summary file is empty", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-compact-state-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const getSessionCompactionState = vi.fn().mockResolvedValue({
      sessionId: "s1",
      preservedTailStartTurn: 7,
      preservedTailMessageId: "m7",
      summarizedThroughMessageId: null,
      mode: "transcript-fallback",
      summaryOverrideText: "Recovered compact summary from transcript fallback.",
      updatedAt: Date.now(),
    });
    const runtimeStore = asRuntimeStore({
      getDreamState: vi.fn().mockResolvedValue(null),
      listScopedSessionIdsTouchedSince: vi.fn().mockResolvedValue(["s1"]),
      touchDreamAttempt: vi.fn().mockResolvedValue(undefined),
      acquireDreamLock: vi.fn(),
      listRecentContextArchiveRuns: vi.fn().mockResolvedValue([]),
      listContextArchiveEvents: vi.fn().mockResolvedValue([]),
      listRecentMaintenanceRuns: vi.fn().mockResolvedValue([]),
      getSessionSummaryState: vi.fn().mockResolvedValue(null),
      getSessionCompactionState,
    });

    const scheduler = new AutoDreamScheduler({
      config: {
        enabled: true,
        minHours: 24,
        minSessions: 1,
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
      triggerSource: "manual_cli",
      bypassGate: true,
      dryRun: true,
    });

    expect(getSessionCompactionState).toHaveBeenCalledWith("s1");
    expect(result.preview?.sessionSummaries).toEqual([
      expect.objectContaining({
        sessionId: "s1",
        source: "compact_summary",
        summaryText: expect.stringContaining("Recovered compact summary"),
      }),
    ]);
  });

  it("waits for the pre-run maintenance hook before collecting dream inputs", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-wait-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "s1",
      content: "# Session Summary\n\n## Current State\nstale summary\n",
    });
    const runtimeStore = asRuntimeStore({
      getDreamState: vi.fn().mockResolvedValue(null),
      listScopedSessionIdsTouchedSince: vi.fn().mockResolvedValue(["s1"]),
      touchDreamAttempt: vi.fn().mockResolvedValue(undefined),
      acquireDreamLock: vi.fn(),
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
    const beforeRun = vi.fn().mockImplementation(async () => {
      await writeSessionSummaryFile({
        agentId: "main",
        sessionId: "s1",
        content: "# Session Summary\n\n## Current State\nfresh summary\n",
      });
    });

    const scheduler = new AutoDreamScheduler({
      config: {
        enabled: true,
        minHours: 24,
        minSessions: 1,
        scanThrottleMs: 600_000,
        lockStaleAfterMs: 3_600_000,
      },
      runtimeStore,
      runner: vi.fn(),
      logger: console,
      beforeRun,
    });
    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    expect(scope).not.toBeNull();

    const result = await scheduler.runNow({
      scope: scope!,
      sessionId: "s1",
      sessionKey: "agent:main:feishu:user-1",
      triggerSource: "stop",
      bypassGate: true,
      dryRun: true,
    });

    expect(beforeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        sessionKey: "agent:main:feishu:user-1",
        triggerSource: "stop",
      }),
    );
    expect(result.preview?.sessionSummaries[0]?.summaryText).toContain("fresh summary");
    expect(result.preview?.sessionSummaries[0]?.summaryText).not.toContain("stale summary");
  });

  it("does not plan transcript fallback when summaries or structured signals are weak", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-fallback-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const runner = vi.fn().mockResolvedValue({
      status: "no_change",
      summary: "no durable changes",
      writtenCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      touchedNotes: [],
    });
    const createMaintenanceRun = vi.fn().mockResolvedValue("mrun-fallback");
    const updateMaintenanceRun = vi.fn().mockResolvedValue(undefined);
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
      acquireDreamLock: vi.fn().mockResolvedValue({
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
      }),
      createMaintenanceRun,
      listRecentContextArchiveRuns: vi.fn().mockResolvedValue([]),
      listContextArchiveEvents: vi.fn().mockResolvedValue([]),
      listRecentMaintenanceRuns: vi.fn().mockResolvedValue([]),
      getSessionSummaryState: vi.fn().mockResolvedValue(null),
      updateMaintenanceRun,
      releaseDreamLock: vi.fn().mockResolvedValue(undefined),
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
    });

    expect(result.status).toBe("started");
    expect(runner).toHaveBeenCalledWith(
      expect.not.objectContaining({ transcriptFallback: expect.anything() }),
      console,
    );
    const metricsJson = updateMaintenanceRun.mock.calls.at(-1)?.[0]?.metricsJson;
    expect(JSON.parse(String(metricsJson))).not.toHaveProperty("transcriptFallback");
  });
});
