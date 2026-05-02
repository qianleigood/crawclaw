import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  writeConfigFileMock: vi.fn(),
  prepareSecretsRuntimeSnapshotMock: vi.fn(),
  resolveMemoryConfigMock: vi.fn(),
  clearNotebookLmProviderStateCacheMock: vi.fn(),
  ensureNotebookLmNotebookMock: vi.fn(),
  inferNotebookLmLoginCommandMock: vi.fn(),
  getNotebookLmProviderStateMock: vi.fn(),
  flushPendingExperienceNotesMock: vi.fn(),
  runNotebookLmLoginCommandMock: vi.fn(),
  normalizeNotebookLmConfigMock: vi.fn(),
  getSharedAutoDreamSchedulerMock: vi.fn(),
  getSharedSessionSummarySchedulerMock: vi.fn(),
  readSessionSummaryFileMock: vi.fn(),
  sqliteRuntimeStoreInitMock: vi.fn(),
  sqliteRuntimeStoreCloseMock: vi.fn(),
  sqliteRuntimeStoreListMessagesByTurnRangeMock: vi.fn(),
  readExperienceIndexEntriesMock: vi.fn(),
  updateExperienceIndexEntryStatusMock: vi.fn(),
  pruneExperienceIndexEntriesMock: vi.fn(),
  listDurableMemoryIndexDocumentsMock: vi.fn(),
  readDurableMemoryIndexDocumentMock: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfigMock,
  writeConfigFile: mocks.writeConfigFileMock,
}));

vi.mock("../../secrets/runtime.js", () => ({
  prepareSecretsRuntimeSnapshot: mocks.prepareSecretsRuntimeSnapshotMock,
}));

vi.mock("../../memory/cli-api.js", () => ({
  clearNotebookLmProviderStateCache: mocks.clearNotebookLmProviderStateCacheMock,
  ensureNotebookLmNotebook: mocks.ensureNotebookLmNotebookMock,
  getNotebookLmProviderState: mocks.getNotebookLmProviderStateMock,
  flushPendingExperienceNotes: mocks.flushPendingExperienceNotesMock,
  getSharedAutoDreamScheduler: mocks.getSharedAutoDreamSchedulerMock,
  getSharedSessionSummaryScheduler: mocks.getSharedSessionSummarySchedulerMock,
  normalizeNotebookLmConfig: mocks.normalizeNotebookLmConfigMock,
  readSessionSummaryFile: mocks.readSessionSummaryFileMock,
  readSessionSummarySectionText: vi.fn(),
  refreshNotebookLmProviderState: vi.fn(),
  resolveDurableMemoryScope: vi.fn(),
  resolveDreamClosedLoopStatus: vi.fn().mockReturnValue({
    closedLoopActive: true,
    closedLoopReason: "active",
  }),
  readDreamConsolidationStatus: vi.fn().mockResolvedValue({
    exists: true,
    lockPath: "/tmp/durable/.consolidate-lock",
    lastConsolidatedAt: 100,
    lockOwner: null,
    lockAcquiredAt: null,
    lockActive: false,
    lockStale: false,
  }),
  resolveMemoryConfig: mocks.resolveMemoryConfigMock,
  listDurableMemoryIndexDocuments: mocks.listDurableMemoryIndexDocumentsMock,
  readDurableMemoryIndexDocument: mocks.readDurableMemoryIndexDocumentMock,
  runDreamAgentOnce: vi.fn(),
  runSessionSummaryAgentOnce: vi.fn(),
  summarizePromptJournal: vi.fn(),
  SqliteRuntimeStore: class {
    init = mocks.sqliteRuntimeStoreInitMock;
    close = mocks.sqliteRuntimeStoreCloseMock;
    listMessagesByTurnRange = mocks.sqliteRuntimeStoreListMessagesByTurnRangeMock;
  },
}));

vi.mock("../../memory/experience/index-store.ts", () => ({
  readExperienceIndexEntries: mocks.readExperienceIndexEntriesMock,
  updateExperienceIndexEntryStatus: mocks.updateExperienceIndexEntryStatusMock,
  pruneExperienceIndexEntries: mocks.pruneExperienceIndexEntriesMock,
  EXPERIENCE_INDEX_STATUSES: ["active", "stale", "superseded", "archived"],
}));

vi.mock("../../memory/notebooklm/login.js", () => ({
  inferNotebookLmLoginCommand: mocks.inferNotebookLmLoginCommandMock,
  runNotebookLmLoginCommand: mocks.runNotebookLmLoginCommandMock,
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
    mocks.writeConfigFileMock.mockResolvedValue(undefined);
    mocks.prepareSecretsRuntimeSnapshotMock.mockResolvedValue({ config: { memory: {} } });
    mocks.normalizeNotebookLmConfigMock.mockReturnValue({
      enabled: false,
      auth: {
        profile: "default",
        cookieFile: "",
        statusTtlMs: 60_000,
        degradedCooldownMs: 120_000,
        refreshCooldownMs: 180_000,
        heartbeat: { enabled: true, minIntervalMs: 1_000, maxIntervalMs: 2_000 },
        autoLogin: {
          enabled: true,
          intervalMs: 86_400_000,
          provider: "nlm_profile",
          cdpUrl: "",
        },
      },
      cli: {
        enabled: false,
        command: "",
        args: ["notebook", "query", "{notebookId}", "{query}", "--json"],
        timeoutMs: 1000,
        limit: 5,
        notebookId: "",
      },
      write: {
        enabled: false,
        command: "",
        args: ["{payloadFile}"],
        timeoutMs: 1000,
        notebookId: "",
      },
    });
    mocks.getNotebookLmProviderStateMock.mockResolvedValue({
      enabled: true,
      ready: true,
      lifecycle: "ready",
      reason: null,
      recommendedAction: "crawclaw memory status",
      profile: "default",
      notebookId: "nb-crawclaw",
      refreshAttempted: false,
      refreshSucceeded: false,
      authSource: "profile",
      lastValidatedAt: "2026-04-30T00:00:00.000Z",
    });
    mocks.ensureNotebookLmNotebookMock.mockResolvedValue({
      status: "selected",
      notebookId: "nb-crawclaw",
      title: "CrawClaw",
      profile: "default",
      sourceCount: 0,
    });
    mocks.inferNotebookLmLoginCommandMock.mockReturnValue({
      command: "nlm",
      args: ["login"],
    });
    mocks.runNotebookLmLoginCommandMock.mockResolvedValue(undefined);
    mocks.resolveMemoryConfigMock.mockReturnValue({
      runtimeStore: { dbPath: "/tmp/memory-runtime.db" },
      dreaming: {
        enabled: true,
        minHours: 24,
        minSessions: 5,
        scanThrottleMs: 600_000,
        lockStaleAfterMs: 3_600_000,
      },
    });
    mocks.sqliteRuntimeStoreInitMock.mockResolvedValue(undefined);
    mocks.sqliteRuntimeStoreCloseMock.mockResolvedValue(undefined);
    mocks.sqliteRuntimeStoreListMessagesByTurnRangeMock.mockResolvedValue([]);
    mocks.readExperienceIndexEntriesMock.mockResolvedValue([]);
    mocks.updateExperienceIndexEntryStatusMock.mockResolvedValue(null);
    mocks.pruneExperienceIndexEntriesMock.mockResolvedValue({
      total: 0,
      retainedIds: [],
      staleIds: [],
      archivedIds: [],
    });
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
    mocks.getSharedAutoDreamSchedulerMock.mockReturnValue({
      runNow: vi.fn().mockResolvedValue({ status: "started", runId: "dream-run-1" }),
    });
  });

  it("sets up the CrawClaw NotebookLM notebook after login succeeds", async () => {
    mocks.loadConfigMock.mockReturnValue({
      memory: {
        notebooklm: {
          enabled: true,
          auth: { profile: "default" },
          cli: { enabled: false },
          write: { enabled: false },
        },
      },
    });
    mocks.prepareSecretsRuntimeSnapshotMock.mockResolvedValue({
      config: {
        memory: {
          notebooklm: {
            enabled: true,
            auth: { profile: "default" },
            cli: { enabled: false },
            write: { enabled: false },
          },
        },
      },
    });
    const normalizedConfig = {
      enabled: true,
      auth: {
        profile: "default",
        cookieFile: "",
        statusTtlMs: 60_000,
        degradedCooldownMs: 120_000,
        refreshCooldownMs: 180_000,
        heartbeat: { enabled: true, minIntervalMs: 1_000, maxIntervalMs: 2_000 },
      },
      cli: {
        enabled: false,
        command: "",
        args: ["notebook", "query", "{notebookId}", "{query}", "--json"],
        timeoutMs: 1000,
        limit: 5,
        notebookId: "",
      },
      write: {
        enabled: false,
        command: "",
        args: ["{payloadFile}"],
        timeoutMs: 1000,
        notebookId: "",
      },
    };
    mocks.normalizeNotebookLmConfigMock
      .mockReturnValueOnce(normalizedConfig)
      .mockReturnValueOnce({
        ...normalizedConfig,
        cli: { ...normalizedConfig.cli, enabled: true, notebookId: "nb-crawclaw" },
        write: { ...normalizedConfig.write, notebookId: "nb-crawclaw" },
      })
      .mockReturnValueOnce({
        ...normalizedConfig,
        cli: { ...normalizedConfig.cli, enabled: true, notebookId: "nb-crawclaw" },
        write: { ...normalizedConfig.write, notebookId: "nb-crawclaw" },
      });
    const opts = createOptions("memory.login", { interactive: true });

    await memoryHandlers["memory.login"](opts);

    expect(mocks.runNotebookLmLoginCommandMock).toHaveBeenCalledWith("nlm", ["login"]);
    expect(mocks.ensureNotebookLmNotebookMock).toHaveBeenCalledWith({
      config: normalizedConfig,
      title: "CrawClaw",
      create: true,
    });
    expect(mocks.writeConfigFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: expect.objectContaining({
          notebooklm: expect.objectContaining({
            enabled: true,
            cli: expect.objectContaining({
              enabled: true,
              notebookId: "nb-crawclaw",
            }),
          }),
        }),
      }),
    );
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        started: true,
        status: "completed",
        providerState: expect.objectContaining({
          ready: true,
          notebookId: "nb-crawclaw",
        }),
      }),
      undefined,
    );
  });

  it("includes file watermark state in dream status responses", async () => {
    const opts = createOptions("memory.dream.status", { scopeKey: "main:telegram:alice" });

    await memoryHandlers["memory.dream.status"](opts);

    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        closedLoopActive: true,
        closedLoopReason: "active",
        historyPersisted: false,
        state: expect.objectContaining({
          lastConsolidatedAt: 100,
          lockActive: false,
        }),
      }),
      undefined,
    );
  });

  it("runs dream from an explicit durable scope key", async () => {
    const opts = createOptions("memory.dream.run", {
      scopeKey: "main:telegram:alice",
      force: true,
      sessionLimit: 3,
      signalLimit: 2,
    });

    await memoryHandlers["memory.dream.run"](opts);

    const scheduler = mocks.getSharedAutoDreamSchedulerMock.mock.results[0]?.value;
    expect(scheduler.runNow).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({
          agentId: "main",
          channel: "telegram",
          userId: "alice",
          scopeKey: "main:telegram:alice",
        }),
        bypassGate: true,
        sessionLimit: 3,
        signalLimit: 2,
      }),
    );
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ status: "started", runId: "dream-run-1" }),
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

    expect(mocks.getSharedSessionSummarySchedulerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          runTimeoutSeconds: 90,
        }),
      }),
    );
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

  it("lists experience index entries with lifecycle filters", async () => {
    mocks.readExperienceIndexEntriesMock.mockResolvedValue([
      {
        id: "experience-index:gateway-recovery",
        title: "网关恢复流程",
        status: "stale",
      },
    ]);
    const opts = createOptions("memory.experience.index.list", {
      status: "stale",
      limit: 5,
    });

    await memoryHandlers["memory.experience.index.list"](opts);

    expect(mocks.readExperienceIndexEntriesMock).toHaveBeenCalledWith(5, { status: "stale" });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      {
        items: [
          expect.objectContaining({
            id: "experience-index:gateway-recovery",
            status: "stale",
          }),
        ],
      },
      undefined,
    );
  });

  it("updates an experience index entry lifecycle status", async () => {
    mocks.updateExperienceIndexEntryStatusMock.mockResolvedValue({
      id: "experience-index:gateway-recovery",
      status: "archived",
      archivedAt: 6_000,
    });
    const opts = createOptions("memory.experience.index.updateStatus", {
      id: "experience-index:gateway-recovery",
      status: "archived",
    });

    await memoryHandlers["memory.experience.index.updateStatus"](opts);

    expect(mocks.updateExperienceIndexEntryStatusMock).toHaveBeenCalledWith({
      id: "experience-index:gateway-recovery",
      status: "archived",
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      {
        item: expect.objectContaining({
          id: "experience-index:gateway-recovery",
          status: "archived",
        }),
      },
      undefined,
    );
  });

  it("runs deterministic experience index pruning", async () => {
    mocks.pruneExperienceIndexEntriesMock.mockResolvedValue({
      total: 3,
      retainedIds: ["experience-index:current"],
      staleIds: ["experience-index:old-active"],
      archivedIds: ["experience-index:old-stale"],
    });
    const opts = createOptions("memory.experience.index.prune", {
      staleAfterMs: 1_000,
      archiveAfterMs: 2_000,
    });

    await memoryHandlers["memory.experience.index.prune"](opts);

    expect(mocks.pruneExperienceIndexEntriesMock).toHaveBeenCalledWith({
      staleAfterMs: 1_000,
      archiveAfterMs: 2_000,
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      {
        result: expect.objectContaining({
          staleIds: ["experience-index:old-active"],
          archivedIds: ["experience-index:old-stale"],
        }),
      },
      undefined,
    );
  });

  it("flushes pending experience notes to NotebookLM", async () => {
    mocks.loadConfigMock.mockResolvedValue({
      memory: {
        notebooklm: { enabled: true },
      },
    });
    mocks.normalizeNotebookLmConfigMock.mockReturnValue({ enabled: true });
    mocks.flushPendingExperienceNotesMock.mockResolvedValue({
      status: "ok",
      scanned: 2,
      synced: 2,
      failed: 0,
      skipped: false,
      sourceSyncStatus: "ok",
      sourceId: "source-1",
      errors: [],
    });
    const opts = createOptions("memory.experience.sync.flush", {});

    await memoryHandlers["memory.experience.sync.flush"](opts);

    expect(mocks.flushPendingExperienceNotesMock).toHaveBeenCalledWith({
      config: { enabled: true },
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      {
        result: expect.objectContaining({
          scanned: 2,
          synced: 2,
          failed: 0,
        }),
      },
      undefined,
    );
  });

  it("lists durable memory index documents", async () => {
    mocks.listDurableMemoryIndexDocumentsMock.mockResolvedValue({
      items: [
        {
          id: "agents/main/channels/discord/users/user/MEMORY.md",
          scopeKey: "main:discord:user",
          title: "MEMORY.md",
        },
      ],
    });
    const opts = createOptions("memory.durable.index.list", { limit: 5 });

    await memoryHandlers["memory.durable.index.list"](opts);

    expect(mocks.listDurableMemoryIndexDocumentsMock).toHaveBeenCalledWith({ limit: 5 });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      {
        items: [
          expect.objectContaining({
            id: "agents/main/channels/discord/users/user/MEMORY.md",
            scopeKey: "main:discord:user",
          }),
        ],
      },
      undefined,
    );
  });

  it("opens a durable memory index document", async () => {
    mocks.readDurableMemoryIndexDocumentMock.mockResolvedValue({
      item: {
        id: "agents/main/channels/discord/users/user/MEMORY.md",
        scopeKey: "main:discord:user",
        title: "MEMORY.md",
      },
      content: "# MEMORY.md\n\n- [Gateway](./20 Projects/gateway.md)\n",
    });
    const opts = createOptions("memory.durable.index.get", {
      id: "agents/main/channels/discord/users/user/MEMORY.md",
    });

    await memoryHandlers["memory.durable.index.get"](opts);

    expect(mocks.readDurableMemoryIndexDocumentMock).toHaveBeenCalledWith({
      id: "agents/main/channels/discord/users/user/MEMORY.md",
    });
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        content: expect.stringContaining("Gateway"),
      }),
      undefined,
    );
  });
});
