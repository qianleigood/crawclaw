import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  prepareSecretsRuntimeSnapshotMock: vi.fn(),
  resolveMemoryConfigMock: vi.fn(),
  sqliteRuntimeStoreInitMock: vi.fn(),
  sqliteRuntimeStoreCloseMock: vi.fn(),
  sqliteRuntimeStoreGetDreamStateMock: vi.fn(),
  sqliteRuntimeStoreListRecentMaintenanceRunsMock: vi.fn(),
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
  getSharedSessionSummaryScheduler: vi.fn(),
  normalizeNotebookLmConfig: vi.fn().mockReturnValue({
    enabled: false,
    auth: { profile: "default" },
    cli: { notebookId: null },
  }),
  readSessionSummaryFile: vi.fn(),
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
});
