import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveDefaultSessionStorePath,
  resolveSessionTranscriptPath,
} from "../../config/sessions/paths.js";
import { resolveDurableMemoryScope } from "../durable/scope.js";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { AutoDreamScheduler, __testing } from "./auto-dream.js";
import {
  readDreamConsolidationStatus,
  tryAcquireDreamConsolidationLock,
} from "./consolidation-lock.js";

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

async function writeSessionStore(params: {
  agentId?: string;
  entries: Array<{ sessionKey: string; sessionId: string; updatedAt?: number }>;
}) {
  const storePath = resolveDefaultSessionStorePath(params.agentId ?? "main");
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const store = Object.fromEntries(
    params.entries.map((entry, index) => [
      entry.sessionKey,
      {
        sessionId: entry.sessionId,
        updatedAt: entry.updatedAt ?? index + 1,
      },
    ]),
  );
  await fs.writeFile(storePath, `${JSON.stringify(store)}\n`);
  return storePath;
}

async function writeSameScopeSessionStore(params: {
  agentId?: string;
  channel?: string;
  userId?: string;
  sessionIds: string[];
}) {
  const agentId = params.agentId ?? "main";
  const channel = params.channel ?? "feishu";
  const userId = params.userId ?? "user-1";
  await writeSessionStore({
    agentId,
    entries: params.sessionIds.map((sessionId, index) => ({
      sessionKey: `agent:${agentId}:${channel}:direct:${userId}:thread:t${index + 1}`,
      sessionId,
      updatedAt: index + 1,
    })),
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

  it("does not auto-schedule when dreaming is disabled", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-disabled-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const runner = vi.fn();
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ enabled: false }),
      runtimeStore: createRuntimeStore(),
      runner,
      logger: console,
    });

    scheduler.submitTurn({
      sessionId: "session-disabled",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session-disabled.jsonl",
      workspaceDir: stateDir,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-1",
      },
    });
    await Promise.resolve();

    expect(runner).not.toHaveBeenCalled();
  });

  it("uses a scope file lock as the dream watermark and run lock", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-lock-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const sessionIds = ["s1", "s2", "s3", "s4", "s5"];
    await writeSameScopeSessionStore({ sessionIds });
    await Promise.all(
      sessionIds.map(async (sessionId, index) => {
        await writeTranscript({ sessionId, mtimeMs: 10_000 + index });
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
      triggerSource: "manual_cli",
      bypassGate: true,
    });

    expect(result.status).toBe("started");
    expect(result.runId).toMatch(/^dream_/);
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: result.runId,
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

  it("skips when the minimum hour gate is not met", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-hours-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const sessionIds = ["s1", "s2", "s3", "s4", "s5"];
    await writeSameScopeSessionStore({ sessionIds });
    await Promise.all(
      sessionIds.map((sessionId) => writeTranscript({ sessionId, mtimeMs: 10_000 })),
    );
    vi.useFakeTimers({ now: new Date(30_000) });
    const runner = vi.fn().mockResolvedValue({
      status: "no_change",
      summary: "nothing changed",
      writtenCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      touchedNotes: [],
    });
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minHours: 1, scanThrottleMs: 0 }),
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

    await scheduler.runNow({
      scope: scope!,
      triggerSource: "manual_cli",
      bypassGate: true,
    });
    vi.setSystemTime(new Date(30 * 60_000));

    const result = await scheduler.runNow({
      scope: scope!,
      triggerSource: "manual_cli",
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "min_hours_gate",
    });
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("skips when the scan throttle window is still active", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-throttle-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSameScopeSessionStore({ sessionIds: ["s1"] });
    await writeTranscript({ sessionId: "s1", mtimeMs: 10_000 });
    vi.useFakeTimers({ now: new Date(30_000) });
    const runner = vi.fn();
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minHours: 0, minSessions: 1, scanThrottleMs: 600_000 }),
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

    const first = await scheduler.runNow({
      scope: scope!,
      triggerSource: "manual_cli",
      dryRun: true,
    });
    const second = await scheduler.runNow({
      scope: scope!,
      triggerSource: "manual_cli",
      dryRun: true,
    });

    expect(first.status).toBe("preview");
    expect(second).toEqual({
      status: "skipped",
      reason: "scan_throttle",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("skips when another active dream lock is already held for the scope", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-held-lock-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSameScopeSessionStore({ sessionIds: ["s1"] });
    await writeTranscript({ sessionId: "s1", mtimeMs: 10_000 });
    vi.useFakeTimers({ now: new Date(30_000) });
    const runner = vi.fn();
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minHours: 0, minSessions: 1, scanThrottleMs: 0 }),
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

    const lock = await tryAcquireDreamConsolidationLock({
      scope: scope!,
      owner: "other-dream",
      staleAfterMs: dreamConfig().lockStaleAfterMs,
      now: Date.now(),
    });
    expect(lock.acquired).toBe(true);

    const result = await scheduler.runNow({
      scope: scope!,
      triggerSource: "manual_cli",
      bypassGate: true,
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "lock_held",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("keeps sessions touched during a dream run for the next pass", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-next-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const sessionIds = ["s1", "s2", "s3", "s4", "s5", "s-new"];
    await writeSameScopeSessionStore({ sessionIds });
    for (const sessionId of ["s1", "s2", "s3", "s4", "s5"]) {
      await writeTranscript({ sessionId, mtimeMs: 10_000 });
    }
    vi.useFakeTimers({ now: new Date(30_000) });
    const runner = vi.fn().mockImplementation(async () => {
      await writeTranscript({ sessionId: "s-new", mtimeMs: 35_000 });
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
    await writeSameScopeSessionStore({ sessionIds: ["s1", "s2", "s3", "s4", "s5", "s6"] });
    for (const sessionId of ["s1", "s2", "s3", "s4", "s5"]) {
      await writeTranscript({ sessionId, mtimeMs: 10_000 });
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
    await writeSameScopeSessionStore({ sessionIds: ["s1", "s2", "s3", "s4", "s5"] });
    for (const sessionId of ["s1", "s2", "s3", "s4", "s5"]) {
      await writeTranscript({ sessionId });
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

  it("limits recent transcripts to the current durable scope", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-scope-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSessionStore({
      entries: [
        { sessionKey: "agent:main:feishu:direct:user-1", sessionId: "current-session" },
        {
          sessionKey: "agent:main:feishu:direct:user-1:thread:thread-1",
          sessionId: "same-scope-thread",
        },
        { sessionKey: "agent:main:feishu:direct:user-2", sessionId: "other-user-session" },
        { sessionKey: "agent:main:discord:direct:user-1", sessionId: "other-channel-session" },
      ],
    });
    await writeTranscript({ sessionId: "current-session", mtimeMs: 40_000 });
    await writeTranscript({ sessionId: "same-scope-thread", mtimeMs: 30_000 });
    await writeTranscript({ sessionId: "other-user-session", mtimeMs: 35_000 });
    await writeTranscript({ sessionId: "other-channel-session", mtimeMs: 34_000 });

    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minSessions: 1 }),
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
      triggerSource: "manual_cli",
      bypassGate: true,
      dryRun: true,
    });

    expect(result.preview?.recentSessionIds).toEqual(["current-session", "same-scope-thread"]);
  });

  it("includes the triggering stop-phase session in the current dream input", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-stop-current-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSessionStore({
      entries: [
        { sessionKey: "agent:main:feishu:direct:user-1", sessionId: "current-session" },
        {
          sessionKey: "agent:main:feishu:direct:user-1:thread:thread-1",
          sessionId: "older-session",
        },
      ],
    });
    await writeTranscript({ sessionId: "current-session", mtimeMs: 40_000 });
    await writeTranscript({ sessionId: "older-session", mtimeMs: 30_000 });

    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minSessions: 1 }),
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
      sessionId: "current-session",
      triggerSource: "stop",
      bypassGate: true,
      dryRun: true,
    });

    expect(result.preview?.recentSessionIds).toEqual(["current-session", "older-session"]);
  });

  it("counts the triggering stop-phase session toward the min-session gate", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-stop-gate-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSessionStore({
      entries: [{ sessionKey: "agent:main:feishu:direct:user-1", sessionId: "current-session" }],
    });
    await writeTranscript({ sessionId: "current-session", mtimeMs: 40_000 });

    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minSessions: 1 }),
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
      sessionId: "current-session",
      triggerSource: "stop",
      dryRun: true,
    });

    expect(result.status).toBe("preview");
    expect(result.preview?.recentSessionIds).toEqual(["current-session"]);
  });

  it("does not read session summary or compaction state for dream previews", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-no-summary-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSameScopeSessionStore({ sessionIds: ["s1"] });
    await writeTranscript({ sessionId: "s1" });
    const getSessionSummaryState = vi.fn().mockResolvedValue({
      lastSummarizedMessageId: "msg-1",
      lastSummaryUpdatedAt: Date.now(),
      tokensAtLastSummary: 8_000,
      summaryInProgress: false,
    });
    const getSessionCompactionState = vi.fn().mockResolvedValue({
      sessionId: "s1",
      summaryOverrideText: "Recovered compact summary that dream should ignore.",
      updatedAt: Date.now(),
    });
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minSessions: 1 }),
      runtimeStore: createRuntimeStore({
        getSessionSummaryState,
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

    expect(getSessionSummaryState).not.toHaveBeenCalled();
    expect(getSessionCompactionState).not.toHaveBeenCalled();
    expect(result.preview?.transcriptRefs).toEqual([expect.objectContaining({ sessionId: "s1" })]);
  });

  it("waits for the pre-run maintenance hook before collecting structured signals", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-auto-dream-wait-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSameScopeSessionStore({ sessionIds: ["s1"] });
    await writeTranscript({ sessionId: "s1" });
    let maintenanceFinished = false;
    const beforeRun = vi.fn().mockImplementation(async () => {
      maintenanceFinished = true;
    });
    const scheduler = new AutoDreamScheduler({
      config: dreamConfig({ minSessions: 1 }),
      runtimeStore: createRuntimeStore({
        listRecentContextArchiveRuns: vi.fn().mockImplementation(async () =>
          maintenanceFinished
            ? [
                {
                  id: "run-1",
                  sessionId: "s1",
                  startedAt: Date.now(),
                  endedAt: Date.now(),
                },
              ]
            : [],
        ),
        listContextArchiveEvents: vi.fn().mockResolvedValue([
          {
            id: "event-1",
            runId: "run-1",
            sessionId: "s1",
            eventKind: "agent.action",
            payloadJson: JSON.stringify({
              action: {
                title: "Dream can see fresh maintenance signal",
                summary: "after beforeRun",
              },
            }),
            createdAt: Date.now(),
          },
        ]),
      }),
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
    expect(result.preview?.recentSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "archive_actions",
          text: "Dream can see fresh maintenance signal (after beforeRun)",
        }),
      ]),
    );
  });
});
