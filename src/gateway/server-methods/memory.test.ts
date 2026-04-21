import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  prepareSecretsRuntimeSnapshotMock: vi.fn(),
  resolveMemoryConfigMock: vi.fn(),
  getSharedSessionSummarySchedulerMock: vi.fn(),
  readSessionSummaryFileMock: vi.fn(),
  sqliteRuntimeStoreInitMock: vi.fn(),
  sqliteRuntimeStoreCloseMock: vi.fn(),
  sqliteRuntimeStoreGetDreamStateMock: vi.fn(),
  sqliteRuntimeStoreListRecentMaintenanceRunsMock: vi.fn(),
  sqliteRuntimeStoreListMessagesByTurnRangeMock: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfigMock,
}));

vi.mock("../../secrets/runtime.js", () => ({
  prepareSecretsRuntimeSnapshot: mocks.prepareSecretsRuntimeSnapshotMock,
}));

vi.mock("../../memory/cli-api.js", () => ({
  clearNotebookLmProviderStateCache: vi.fn(),
  getNotebookLmProviderState: vi.fn(),
  getSharedAutoDreamScheduler: vi.fn(),
  getSharedSessionSummaryScheduler: mocks.getSharedSessionSummarySchedulerMock,
  normalizeNotebookLmConfig: vi.fn().mockReturnValue({
    enabled: false,
    auth: { profile: "default" },
    cli: { notebookId: null },
  }),
  readSessionSummaryFile: mocks.readSessionSummaryFileMock,
  readSessionSummarySectionText: vi.fn(),
  refreshNotebookLmProviderState: vi.fn(),
  resolveDurableMemoryScope: vi.fn(),
  resolveMemoryConfig: mocks.resolveMemoryConfigMock,
  runDreamAgentOnce: vi.fn(),
  runSessionSummaryAgentOnce: vi.fn(),
  summarizePromptJournal: vi.fn(),
  SqliteRuntimeStore: class {
    init = mocks.sqliteRuntimeStoreInitMock;
    close = mocks.sqliteRuntimeStoreCloseMock;
    getDreamState = mocks.sqliteRuntimeStoreGetDreamStateMock;
    listRecentMaintenanceRuns = mocks.sqliteRuntimeStoreListRecentMaintenanceRunsMock;
    listMessagesByTurnRange = mocks.sqliteRuntimeStoreListMessagesByTurnRangeMock;
  },
}));

const { memoryHandlers } = await import("./memory.js");

function createOptions(
  method: string,
  params: Record<string, unknown>,
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {
      disconnectClientsForDevice: vi.fn(),
      logGateway: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      },
    },
  } as unknown as GatewayRequestHandlerOptions;
}

describe("memoryHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigMock.mockReturnValue({ memory: {} });
    mocks.prepareSecretsRuntimeSnapshotMock.mockResolvedValue({ config: { memory: {} } });
    mocks.resolveMemoryConfigMock.mockReturnValue({
      runtimeStore: { dbPath: "/tmp/memory-runtime.db" },
      dreaming: {
        enabled: true,
        minHours: 24,
        minSessions: 5,
        scanThrottleMs: 600_000,
      },
    });
    mocks.sqliteRuntimeStoreInitMock.mockResolvedValue(undefined);
    mocks.sqliteRuntimeStoreCloseMock.mockResolvedValue(undefined);
    mocks.sqliteRuntimeStoreGetDreamStateMock.mockResolvedValue(null);
    mocks.sqliteRuntimeStoreListMessagesByTurnRangeMock.mockResolvedValue([]);
    mocks.readSessionSummaryFileMock.mockResolvedValue({
      summaryPath: "/tmp/session-summary/agents/main/sessions/sess-1/summary.md",
      exists: true,
      updatedAt: 100,
      document: null,
      content: "",
    });
    mocks.getSharedSessionSummarySchedulerMock.mockReturnValue({
      runNow: vi.fn().mockResolvedValue({ status: "started", runId: "summary-run-1" }),
    });
  });

  it("includes touched notes in dream status responses", async () => {
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
    const opts = createOptions("memory.dream.status", { scopeKey: "main:telegram:alice" });

    await memoryHandlers["memory.dream.status"](opts);

    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        runs: [
          expect.objectContaining({
            touchedNotes: ["project/gateway-recovery.md", "feedback/answer-style.md"],
          }),
        ],
      }),
      undefined,
    );
  });

  it("builds a parent fork context for session summary refresh", async () => {
    mocks.resolveMemoryConfigMock.mockReturnValue({
      runtimeStore: { dbPath: "/tmp/memory-runtime.db" },
      sessionSummary: {
        enabled: true,
        lightInitTokenThreshold: 3_000,
        minTokensToInit: 10_000,
        minTokensBetweenUpdates: 5_000,
        toolCallsBetweenUpdates: 3,
        maxWaitMs: 15_000,
        maxTurns: 5,
      },
    });
    mocks.sqliteRuntimeStoreListMessagesByTurnRangeMock.mockResolvedValue([
      { id: "m1", role: "user", content: "Do the thing", contentText: "Do the thing" },
      { id: "m2", role: "assistant", content: "Done", contentText: "Done" },
    ]);
    const opts = createOptions("memory.sessionSummary.refresh", {
      sessionId: "sess-1",
      sessionKey: "agent:main:sess-1",
      force: true,
    });

    await memoryHandlers["memory.sessionSummary.refresh"](opts);

    const scheduler = mocks.getSharedSessionSummarySchedulerMock.mock.results[0]?.value;
    expect(scheduler.runNow).toHaveBeenCalledWith(
      expect.objectContaining({
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
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ sessionId: "sess-1" }),
      undefined,
    );
  });
});
