import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSessionTranscriptPath } from "../../config/sessions/paths.js";
import { resolveDurableMemoryScope } from "../durable/scope.js";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { writeSessionSummaryFile } from "../session-summary/store.ts";
import { AutoDreamScheduler, __testing } from "./auto-dream.js";
import { readDreamConsolidationStatus } from "./consolidation-lock.js";

function asRuntimeStore(store: Partial<RuntimeStore>): RuntimeStore {
  return store as RuntimeStore;
}

function dreamConfig(
  overrides: Partial<ConstructorParameters<typeof AutoDreamScheduler>[0]["config"]> = {},
) {
  return {
    enabled: true,
    minHours: 24,
    minSessions: 5,
    scanThrottleMs: 600_000,
    lockStaleAfterMs: 3_600_000,
    ...overrides,
  };
}

function createRuntimeStore(overrides: Partial<RuntimeStore> = {}): RuntimeStore {
  return asRuntimeStore({
    listRecentContextArchiveRuns: vi.fn().mockResolvedValue([]),
    listContextArchiveEvents: vi.fn().mockResolvedValue([]),
    getSessionSummaryState: vi.fn().mockResolvedValue({
      lastSummarizedMessageId: "msg-1",
      lastSummaryUpdatedAt: Date.now(),
      tokensAtLastSummary: 120,
      summaryInProgress: false,
    }),
    getSessionCompactionState: vi.fn().mockResolvedValue(null),
    ...overrides,
  });
}

async function writeTranscript(params: { agentId?: string; sessionId: string; mtimeMs?: number }) {
  const filePath = resolveSessionTranscriptPath(params.sessionId, params.agentId ?? "main");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `{"type":"message","sessionId":"${params.sessionId}"}\n`);
  if (params.mtimeMs !== undefined) {
    const date = new Date(params.mtimeMs);
    await fs.utimes(filePath, date, date);
  }
  return filePath;
}

async function writeSummary(sessionId: string) {
  await writeSessionSummaryFile({
    agentId: "main",
    sessionId,
    content: `# Session Summary\n\n## Current State\nsummary:${sessionId}\n`,
  });
}

describe("AutoDreamScheduler", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    __testing.resetSharedAutoDreamScheduler();
    vi.useRealTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    delete process.env.CRAWCLAW_STATE_DIR;
    __testing.resetSharedAutoDreamScheduler();
  });

  it("skips when min-session gate is not met without touching runtime DB dream state", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-gate-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeTranscript({ sessionId: "s1" });

    const scheduler = new AutoDreamScheduler({
      config: dreamConfig(),
      runtimeStore: createRuntimeStore(),
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
    const status = await readDreamConsolidationStatus({
      scope: scope!,
      staleAfterMs: dreamConfig().lockStaleAfterMs,
    });
    expect(status.exists).toBe(false);
  });

  it("uses a scope file lock as the dream watermark and run lock", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-lock-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const sessionIds = ["s1", "s2", "s3", "s4", "s5"];
    await Promise.all(
      sessionIds.map(async (sessionId, index) => {
        await writeTranscript({ sessionId, mtimeMs: 10_000 + index });
        await writeSummary(sessionId);
      }),
    );
    vi.useFakeTimers({ now: new Date(30_000) });
    const runner = vi.fn().mockResolvedValue({
      status: "written",
      summary: "merged duplicate feedback notes",
      writtenCount: 1,
      updatedCount: 2,
      deletedCount: 1,
      touchedNotes: ["feedback/answer-style.md", "project/gateway-recovery.md"],
    });

    const scheduler = new AutoDreamScheduler({
      config: dreamConfig(),
      runtimeStore: createRuntimeStore(),
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
    expect(result.runId).toMatch(/^dream_/);
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: result.runId,
        parentRunId: "parent-run-1",
        scope,
        lastSuccessAt: null,
        recentTranscriptRefs: sessionIds
          .slice()
          .toReversed()
          .map((sessionId) => expect.objectContaining({ sessionId })),
        recentSignals: expect.any(Array),
      }),
      console,
    );
    const status = await readDreamConsolidationStatus({
      scope: scope!,
      staleAfterMs: dreamConfig().lockStaleAfterMs,
      now: Date.now(),
    });
    expect(status.exists).toBe(true);
    expect(status.lastConsolidatedAt).toBe(30_000);
    expect(status.lockActive).toBe(false);
    expect(status.lockOwner).toBeNull();
  });

  it("keeps sessions touched during a dream run for the next pass", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-next-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    for (const sessionId of ["s1", "s2", "s3", "s4", "s5"]) {
      await writeTranscript({ sessionId, mtimeMs: 10_000 });
      await writeSummary(sessionId);
    }
    vi.useFakeTimers({ now: new Date(30_000) });
    const runner = vi.fn().mockImplementation(async () => {
      await writeTranscript({ sessionId: "s-new", mtimeMs: 35_000 });
      await writeSummary("s-new");
      return {
        status: "no_change",
        summary: "nothing changed",
        writtenCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        touchedNotes: [],
      };
    });
    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    expect(scope).not.toBeNull();
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minHours: 0, scanThrottleMs: 0 }),
      runtimeStore: createRuntimeStore(),
      runner,
      logger: console,
    });

    await scheduler.runNow({
      scope: scope!,
      triggerSource: "manual_cli",
      bypassGate: true,
    });

    const preview = await scheduler.runNow({
      scope: scope!,
      triggerSource: "manual_cli",
      bypassGate: true,
      dryRun: true,
    });
    expect(preview.preview?.recentSessionIds).toEqual(["s-new"]);
  });

  it("rolls back the file watermark when the dream run fails", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-rollback-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    for (const sessionId of ["s1", "s2", "s3", "s4", "s5"]) {
      await writeTranscript({ sessionId, mtimeMs: 10_000 });
      await writeSummary(sessionId);
    }
    vi.useFakeTimers({ now: new Date(30_000) });
    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    expect(scope).not.toBeNull();
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minHours: 0, scanThrottleMs: 0 }),
      runtimeStore: createRuntimeStore(),
      runner: vi.fn().mockResolvedValue({
        status: "no_change",
        summary: "nothing changed",
        writtenCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        touchedNotes: [],
      }),
      logger: console,
    });
    await scheduler.runNow({
      scope: scope!,
      triggerSource: "manual_cli",
      bypassGate: true,
    });

    await writeTranscript({ sessionId: "s6", mtimeMs: 35_000 });
    await writeSummary("s6");
    vi.setSystemTime(new Date(40_000));
    scheduler.reconfigure({
      config: dreamConfig({ minHours: 0, scanThrottleMs: 0 }),
      runtimeStore: createRuntimeStore(),
      runner: vi.fn().mockRejectedValue(new Error("boom")),
      logger: console,
    });
    const failed = await scheduler.runNow({
      scope: scope!,
      triggerSource: "manual_cli",
      bypassGate: true,
    });

    expect(failed.status).toBe("failed");
    const status = await readDreamConsolidationStatus({
      scope: scope!,
      staleAfterMs: dreamConfig().lockStaleAfterMs,
      now: Date.now(),
    });
    expect(status.lastConsolidatedAt).toBe(30_000);
    const preview = await scheduler.runNow({
      scope: scope!,
      triggerSource: "manual_cli",
      bypassGate: true,
      dryRun: true,
    });
    expect(preview.preview?.recentSessionIds).toEqual(["s6"]);
  });

  it("supports dry-run preview without acquiring the lock or spawning consolidation", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-dry-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    for (const sessionId of ["s1", "s2", "s3", "s4", "s5"]) {
      await writeTranscript({ sessionId });
      await writeSummary(sessionId);
    }
    const runner = vi.fn();
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig(),
      runtimeStore: createRuntimeStore(),
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
    expect(result.preview?.recentSessionIds).toHaveLength(3);
    expect(runner).not.toHaveBeenCalled();
    const status = await readDreamConsolidationStatus({
      scope: scope!,
      staleAfterMs: dreamConfig().lockStaleAfterMs,
    });
    expect(status.exists).toBe(false);
  });

  it("compacts session summaries before passing them to the dream runner", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-compact-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeTranscript({ sessionId: "s1" });
    const longBody = `${"stable durable signal ".repeat(2_000)}tail-marker-should-not-survive`;
    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "s1",
      content: `# Session Summary\n\n## Current State\n${longBody}\n\n## Key Results\nfinal result\n`,
    });
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minSessions: 1 }),
      runtimeStore: createRuntimeStore({
        getSessionSummaryState: vi.fn().mockResolvedValue({
          lastSummarizedMessageId: "msg-1",
          lastSummaryUpdatedAt: Date.now(),
          tokensAtLastSummary: 8_000,
          summaryInProgress: false,
        }),
      }),
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
    await writeTranscript({ sessionId: "s1" });
    const getSessionCompactionState = vi.fn().mockResolvedValue({
      sessionId: "s1",
      preservedTailStartTurn: 7,
      preservedTailMessageId: "m7",
      summarizedThroughMessageId: null,
      mode: "transcript-fallback",
      summaryOverrideText: "Recovered compact summary from transcript fallback.",
      updatedAt: Date.now(),
    });
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minSessions: 1 }),
      runtimeStore: createRuntimeStore({
        getSessionSummaryState: vi.fn().mockResolvedValue(null),
        getSessionCompactionState,
      }),
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
    await writeTranscript({ sessionId: "s1" });
    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "s1",
      content: "# Session Summary\n\n## Current State\nstale summary\n",
    });
    const beforeRun = vi.fn().mockImplementation(async () => {
      await writeSessionSummaryFile({
        agentId: "main",
        sessionId: "s1",
        content: "# Session Summary\n\n## Current State\nfresh summary\n",
      });
    });
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minSessions: 1 }),
      runtimeStore: createRuntimeStore(),
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
      sessionId: "current-session",
      sessionKey: "agent:main:feishu:user-1",
      triggerSource: "stop",
      bypassGate: true,
      dryRun: true,
    });

    expect(beforeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "current-session",
        sessionKey: "agent:main:feishu:user-1",
        triggerSource: "stop",
      }),
    );
    expect(result.preview?.sessionSummaries[0]?.summaryText).toContain("fresh summary");
    expect(result.preview?.sessionSummaries[0]?.summaryText).not.toContain("stale summary");
  });
});
