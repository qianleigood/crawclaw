import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCliRuntimeCapture } from "./test-runtime-capture.js";

const mocks = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  resolveCommandSecretRefsViaGatewayMock: vi.fn(),
  resolveMemoryConfigMock: vi.fn(),
  getSharedAutoDreamSchedulerMock: vi.fn(),
  getSharedSessionSummarySchedulerMock: vi.fn(),
  sqliteRuntimeStoreInitMock: vi.fn(),
  sqliteRuntimeStoreCloseMock: vi.fn(),
  sqliteRuntimeStoreGetDreamStateMock: vi.fn(),
  sqliteRuntimeStoreListRecentMaintenanceRunsMock: vi.fn(),
  sqliteRuntimeStoreGetSessionSummaryStateMock: vi.fn(),
  sqliteRuntimeStoreListMessagesByTurnRangeMock: vi.fn(),
  readSessionSummaryFileMock: vi.fn(),
}));

const { runtimeLogs, runtimeErrors, defaultRuntime, resetRuntimeCapture } =
  createCliRuntimeCapture();

vi.mock("../runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime.js")>()),
  defaultRuntime,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfigMock,
}));

vi.mock("../cli/command-secret-gateway.js", () => ({
  resolveCommandSecretRefsViaGateway: mocks.resolveCommandSecretRefsViaGatewayMock,
}));

vi.mock("../memory/config/resolve.js", () => ({
  resolveMemoryConfig: mocks.resolveMemoryConfigMock,
}));

vi.mock("../memory/dreaming/auto-dream.js", () => ({
  getSharedAutoDreamScheduler: mocks.getSharedAutoDreamSchedulerMock,
}));

vi.mock("../memory/dreaming/agent-runner.js", () => ({
  runDreamAgentOnce: vi.fn(),
}));

vi.mock("../memory/session-summary/scheduler.ts", () => ({
  getSharedSessionSummaryScheduler: mocks.getSharedSessionSummarySchedulerMock,
}));

vi.mock("../memory/session-summary/agent-runner.ts", () => ({
  runSessionSummaryAgentOnce: vi.fn(),
}));

vi.mock("../memory/session-summary/template.ts", () => ({
  inferSessionSummaryProfile: vi.fn().mockReturnValue("full"),
}));

vi.mock("../memory/session-summary/store.ts", () => ({
  readSessionSummaryFile: mocks.readSessionSummaryFileMock,
  readSessionSummarySectionText: ({
    content,
    section,
  }: {
    content?: string | null;
    section: string;
  }) => {
    const text = content ?? "";
    const headings: Record<string, string> = {
      currentState: "## Current State",
      openLoops: "## Open Loops",
      taskSpecification: "## Task Specification",
      keyResults: "## Key Results",
      errorsAndCorrections: "## Errors and Corrections",
    };
    const marker = headings[section] ?? "";
    const start = text.indexOf(marker);
    if (start < 0) {
      return "";
    }
    const body = text.slice(start + marker.length).trimStart();
    const nextHeading = body.indexOf("\n## ");
    return (nextHeading >= 0 ? body.slice(0, nextHeading) : body).trim();
  },
}));

vi.mock("../memory/runtime/sqlite-runtime-store.js", () => ({
  SqliteRuntimeStore: class {
    init = mocks.sqliteRuntimeStoreInitMock;
    close = mocks.sqliteRuntimeStoreCloseMock;
    getDreamState = mocks.sqliteRuntimeStoreGetDreamStateMock;
    listRecentMaintenanceRuns = mocks.sqliteRuntimeStoreListRecentMaintenanceRunsMock;
    getSessionSummaryState = mocks.sqliteRuntimeStoreGetSessionSummaryStateMock;
    listMessagesByTurnRange = mocks.sqliteRuntimeStoreListMessagesByTurnRangeMock;
  },
}));

const {
  runMemoryDreamStatus,
  runMemoryDreamHistory,
  runMemoryDreamRun,
  runMemorySessionSummaryStatus,
  runMemorySessionSummaryRefresh,
} = await import("./memory-cli.runtime.js");

describe("memory-cli dream runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeCapture();
    mocks.loadConfigMock.mockReturnValue({ memory: {} });
    mocks.resolveCommandSecretRefsViaGatewayMock.mockResolvedValue({
      resolvedConfig: { memory: {} },
      diagnostics: [],
    });
    mocks.resolveMemoryConfigMock.mockReturnValue({
      runtimeStore: { dbPath: "/tmp/memory-runtime.db" },
      dreaming: {
        enabled: true,
        minHours: 24,
        minSessions: 5,
        scanThrottleMs: 600000,
        lockStaleAfterMs: 3600000,
        transcriptFallback: {
          enabled: true,
          minSignals: 2,
          staleSummaryMs: 21_600_000,
          maxSessions: 4,
          maxMatchesPerSession: 2,
          maxTotalBytes: 12_000,
          maxExcerptChars: 900,
        },
      },
      sessionSummary: {
        enabled: true,
        minTokensToInit: 10_000,
        minTokensBetweenUpdates: 5_000,
        toolCallsBetweenUpdates: 3,
        maxWaitMs: 15_000,
        maxTurns: 5,
      },
    });
    mocks.sqliteRuntimeStoreInitMock.mockResolvedValue(undefined);
    mocks.sqliteRuntimeStoreCloseMock.mockResolvedValue(undefined);
    mocks.sqliteRuntimeStoreGetDreamStateMock.mockResolvedValue(null);
    mocks.sqliteRuntimeStoreListRecentMaintenanceRunsMock.mockResolvedValue([]);
    mocks.sqliteRuntimeStoreGetSessionSummaryStateMock.mockResolvedValue(null);
    mocks.sqliteRuntimeStoreListMessagesByTurnRangeMock.mockResolvedValue([]);
    mocks.readSessionSummaryFileMock.mockResolvedValue({
      sessionId: "sess-1",
      agentId: "main",
      summaryPath: "/tmp/session-summary/agents/main/sessions/sess-1/summary.md",
      exists: true,
      content: `# Session Summary

## Current State
Working through the task.

## Open Loops
Need to keep the promotion bridge stable.

## Key Results
Nothing yet.
`,
      bytes: 64,
      updatedAt: 123,
      document: null,
    });
    mocks.getSharedAutoDreamSchedulerMock.mockReturnValue({
      runNow: vi.fn().mockResolvedValue({
        status: "preview",
        reason: "dry_run_preview",
        preview: {
          scopeKey: "main:telegram:alice",
          recentSessionIds: ["s1", "s2"],
          recentSessionCount: 2,
          recentSignalCount: 2,
          recentSignals: [],
          sessionSummaries: [],
          transcriptFallback: {
            enabled: false,
            reasons: [],
            sessionIds: [],
            limits: {
              maxSessions: 4,
              maxMatchesPerSession: 2,
              maxTotalBytes: 12_000,
              maxExcerptChars: 900,
            },
          },
        },
      }),
    });
    mocks.getSharedSessionSummarySchedulerMock.mockReturnValue({
      runNow: vi.fn().mockResolvedValue({
        status: "no_change",
        reason: "manual_refresh",
        runId: "summary-run-1",
      }),
    });
  });

  it("renders dream status with skip reason", async () => {
    mocks.sqliteRuntimeStoreGetDreamStateMock.mockResolvedValue({
      scopeKey: "main:telegram:alice",
      lastSuccessAt: 100,
      lastAttemptAt: 101,
      lastFailureAt: 99,
      lastSkipReason: "min_sessions_gate",
      lockOwner: null,
    });
    mocks.sqliteRuntimeStoreListRecentMaintenanceRunsMock.mockResolvedValue([
      {
        id: "mr-1",
        kind: "dream",
        scope: "main:telegram:alice",
        status: "failed",
        triggerSource: "stop",
        summary: "Dream failed",
        error: "agent_failed",
      },
    ]);

    await runMemoryDreamStatus({
      agent: "main",
      channel: "telegram",
      user: "alice",
    });

    expect(runtimeLogs.join("\n")).toContain("Last skip reason:");
    expect(runtimeLogs.join("\n")).toContain("min_sessions_gate");
    expect(runtimeLogs.join("\n")).toContain("agent_failed");
    expect(runtimeLogs.join("\n")).toContain("Closed loop:");
    expect(runtimeLogs.join("\n")).toContain("active");
    expect(runtimeLogs.join("\n")).toContain("Transcript fallback:");
    expect(runtimeLogs.join("\n")).toContain("maxSessions=4");
  });

  it("renders dream status with touched note diagnostics", async () => {
    mocks.sqliteRuntimeStoreListRecentMaintenanceRunsMock.mockResolvedValue([
      {
        id: "mr-1",
        kind: "dream",
        scope: "main:telegram:alice",
        status: "done",
        triggerSource: "manual_cli",
        summary: "Consolidated gateway notes",
        error: null,
        metricsJson: JSON.stringify({
          touchedNotes: ["project/gateway-recovery.md", "feedback/answer-style.md"],
        }),
      },
    ]);

    await runMemoryDreamStatus({
      agent: "main",
      channel: "telegram",
      user: "alice",
    });

    expect(runtimeLogs.join("\n")).toContain("touched: project/gateway-recovery.md");
    expect(runtimeLogs.join("\n")).toContain("touched: feedback/answer-style.md");
  });

  it("renders dream history with failure reason", async () => {
    mocks.sqliteRuntimeStoreListRecentMaintenanceRunsMock.mockResolvedValue([
      {
        id: "mr-1",
        kind: "dream",
        scope: "main:telegram:alice",
        status: "failed",
        triggerSource: "manual_cli",
        summary: "Dream failed",
        error: "agent_failed",
      },
    ]);

    await runMemoryDreamHistory({});

    expect(runtimeLogs.join("\n")).toContain("Auto Dream History");
    expect(runtimeLogs.join("\n")).toContain("failed");
    expect(runtimeLogs.join("\n")).toContain("agent_failed");
  });

  it("runs dream dry-run preview with bounded session/signal inputs", async () => {
    await runMemoryDreamRun({
      agent: "main",
      channel: "telegram",
      user: "alice",
      dryRun: true,
      sessionLimit: "6",
      signalLimit: "4",
    });

    const scheduler = mocks.getSharedAutoDreamSchedulerMock.mock.results[0]?.value;
    expect(scheduler.runNow).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "manual_cli",
        dryRun: true,
        sessionLimit: 6,
        signalLimit: 4,
      }),
    );
    expect(runtimeLogs.join("\n")).toContain("Auto Dream Run");
    expect(runtimeLogs.join("\n")).toContain("preview");
    expect(runtimeLogs.join("\n")).toContain("Session IDs");
  });

  it("errors when dream run is missing scope options", async () => {
    await runMemoryDreamRun({});

    expect(runtimeErrors.join("\n")).toContain(
      "Memory dream run requires --scope-key or --agent/--channel/--user.",
    );
  });

  it("renders session summary status", async () => {
    mocks.sqliteRuntimeStoreGetSessionSummaryStateMock.mockResolvedValue({
      sessionId: "sess-1",
      lastSummarizedMessageId: "msg-10",
      lastSummaryUpdatedAt: 456,
      tokensAtLastSummary: 789,
      summaryInProgress: false,
      updatedAt: 456,
    });

    await runMemorySessionSummaryStatus({
      agent: "main",
      sessionId: "sess-1",
    });

    expect(runtimeLogs.join("\n")).toContain("Session Summary");
    expect(runtimeLogs.join("\n")).toContain("Profile:");
    expect(runtimeLogs.join("\n")).toContain("msg-10");
    expect(runtimeLogs.join("\n")).toContain("Working through the task.");
    expect(runtimeLogs.join("\n")).toContain("Need to keep the promotion bridge stable.");
  });

  it("runs session summary refresh with bypass gate support", async () => {
    mocks.sqliteRuntimeStoreListMessagesByTurnRangeMock.mockResolvedValue([
      { id: "m1", role: "user", content: "Do the thing", contentText: "Do the thing" },
      { id: "m2", role: "assistant", content: "Done", contentText: "Done" },
    ]);

    await runMemorySessionSummaryRefresh({
      agent: "main",
      sessionId: "sess-1",
      sessionKey: "agent:main:sess-1",
      force: true,
    });

    const scheduler = mocks.getSharedSessionSummarySchedulerMock.mock.results[0]?.value;
    expect(mocks.getSharedSessionSummarySchedulerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          runTimeoutSeconds: 90,
        }),
      }),
    );
    expect(scheduler.runNow).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        sessionKey: "agent:main:sess-1",
        agentId: "main",
        bypassGate: true,
        isSettledTurn: true,
        parentForkContext: expect.objectContaining({
          parentRunId: "manual-session-summary:sess-1",
          promptEnvelope: expect.objectContaining({
            forkContextMessages: [
              expect.objectContaining({ role: "user", content: "Do the thing" }),
              expect.objectContaining({ role: "assistant", content: "Done" }),
            ],
          }),
        }),
      }),
    );
    expect(runtimeLogs.join("\n")).toContain("Session Summary Refresh");
    expect(runtimeLogs.join("\n")).toContain("no_change");
    expect(runtimeLogs.join("\n")).toContain("summary-run-1");
  });

  it("prints the final session summary refresh status in json output", async () => {
    mocks.sqliteRuntimeStoreListMessagesByTurnRangeMock.mockResolvedValue([
      { id: "m1", role: "user", content: "Do the thing", contentText: "Do the thing" },
      { id: "m2", role: "assistant", content: "Done", contentText: "Done" },
    ]);

    await runMemorySessionSummaryRefresh({
      agent: "main",
      sessionId: "sess-1",
      sessionKey: "agent:main:sess-1",
      force: true,
      json: true,
    });

    expect(defaultRuntime.writeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "main",
        sessionId: "sess-1",
        sessionKey: "agent:main:sess-1",
        result: expect.objectContaining({
          status: "no_change",
          reason: "manual_refresh",
          runId: "summary-run-1",
        }),
      }),
    );
  });
});
