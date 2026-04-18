import { describe, expect, it, vi } from "vitest";
import { GatewayRequestError } from "../gateway.ts";
import type { GatewaySessionRow } from "../types.ts";
import {
  loadMemoryDreaming,
  loadMemoryPromptJournal,
  loadMemoryProvider,
  loadMemorySessionSummary,
  refreshMemorySessionSummary,
  runMemoryDream,
  selectMemorySession,
  type MemoryState,
} from "./memory.ts";

function createState(): MemoryState {
  return {
    client: null,
    connected: false,
    activeSection: "provider",
    providerLoading: false,
    providerRefreshing: false,
    providerLoginBusy: false,
    providerStatus: null,
    providerError: null,
    providerActionMessage: null,
    dreamLoading: false,
    dreamError: null,
    dreamStatus: null,
    dreamActionBusy: false,
    dreamActionMessage: null,
    dreamAgent: "",
    dreamChannel: "",
    dreamUser: "",
    dreamScopeKey: "",
    summariesLoading: false,
    summariesError: null,
    summariesStatus: null,
    summariesRefreshBusy: false,
    summariesRefreshResult: null,
    summariesSelectedSessionKey: "",
    summariesSelectedSessionId: "",
    summariesAgentId: "",
    journalLoading: false,
    journalError: null,
    journalSummary: null,
    journalDays: "7",
  };
}

function createClient() {
  return {
    request: vi.fn(),
  };
}

describe("memory controller", () => {
  it("loads provider status through the control-plane method", async () => {
    const state = createState();
    const client = createClient();
    client.request.mockResolvedValue({
      provider: "notebooklm",
      enabled: true,
      ready: true,
      lifecycle: "ready",
      reason: null,
      recommendedAction: "crawclaw memory status",
      profile: "default",
      notebookId: "nb-123",
      refreshAttempted: false,
      refreshSucceeded: false,
      authSource: "cookies",
      lastValidatedAt: "2026-04-18T00:00:00.000Z",
      lastRefreshAt: null,
      nextProbeAt: null,
      nextAllowedRefreshAt: null,
      details: null,
    });
    state.client = client as unknown as MemoryState["client"];
    state.connected = true;

    await loadMemoryProvider(state);

    expect(client.request).toHaveBeenCalledWith("memory.status", { mode: "query" });
    expect(state.providerStatus?.lifecycle).toBe("ready");
    expect(state.providerError).toBeNull();
  });

  it("maps operator.read failures to a friendly provider message", async () => {
    const state = createState();
    const client = createClient();
    client.request.mockRejectedValue(
      new GatewayRequestError({
        code: "INVALID_REQUEST",
        message: "missing scope: operator.read",
        details: {
          code: "SCOPE_MISSING",
          missingScope: "operator.read",
          method: "memory.status",
        },
      }),
    );
    state.client = client as unknown as MemoryState["client"];
    state.connected = true;

    await loadMemoryProvider(state);

    expect(state.providerError).toBe(
      "This connection is missing operator.read, so memory provider status cannot be loaded yet.",
    );
  });

  it("loads dream status and reruns it after a manual run", async () => {
    const state = createState();
    const client = createClient();
    client.request
      .mockResolvedValueOnce({
        enabled: true,
        scopeKey: "agent:main",
        config: { minHours: 12, minSessions: 3, scanThrottleMs: 3000 },
        state: null,
        runs: [],
      })
      .mockResolvedValueOnce({
        status: "completed",
        reason: "completed",
        runId: "dream-1",
      })
      .mockResolvedValueOnce({
        enabled: true,
        scopeKey: "agent:main",
        config: { minHours: 12, minSessions: 3, scanThrottleMs: 3000 },
        state: { lastSuccessAt: "2026-04-18T01:00:00.000Z" },
        runs: [{ status: "completed", scope: "agent:main" }],
      });
    state.client = client as unknown as MemoryState["client"];
    state.connected = true;
    state.dreamAgent = "main";

    await loadMemoryDreaming(state);
    await runMemoryDream(state, { dryRun: true });

    expect(client.request).toHaveBeenNthCalledWith(1, "memory.dream.status", {
      agent: "main",
      limit: 12,
    });
    expect(client.request).toHaveBeenNthCalledWith(2, "memory.dream.run", {
      agent: "main",
      dryRun: true,
    });
    expect(client.request).toHaveBeenNthCalledWith(3, "memory.dream.status", {
      agent: "main",
      limit: 12,
    });
    expect(state.dreamActionMessage).toBe("completed");
    expect(state.dreamStatus?.runs).toHaveLength(1);
  });

  it("selects a session and loads/refreshes its summary", async () => {
    const state = createState();
    const client = createClient();
    const session: GatewaySessionRow = {
      key: "main:dm:user-1:session-1",
      kind: "direct",
      sessionId: "session-1",
      label: "DM user-1",
      displayName: "user-1",
      updatedAt: Date.parse("2026-04-18T02:00:00.000Z"),
    };
    client.request
      .mockResolvedValueOnce({
        agentId: "main",
        sessionId: "session-1",
        summaryPath: "/tmp/session-1.md",
        exists: true,
        updatedAt: "2026-04-18T02:00:00.000Z",
        state: null,
        sections: {
          currentState: "Current",
          taskSpecification: "Task",
          keyResults: "Results",
          errorsAndCorrections: "Errors",
        },
      })
      .mockResolvedValueOnce({
        agentId: "main",
        sessionId: "session-1",
        sessionKey: session.key,
        result: { status: "queued", reason: "queued", runId: "sum-1" },
      })
      .mockResolvedValueOnce({
        agentId: "main",
        sessionId: "session-1",
        summaryPath: "/tmp/session-1.md",
        exists: true,
        updatedAt: "2026-04-18T02:10:00.000Z",
        state: { summaryInProgress: false },
        sections: {
          currentState: "Current",
          taskSpecification: "Task",
          keyResults: "Results",
          errorsAndCorrections: "Errors",
        },
      });
    state.client = client as unknown as MemoryState["client"];
    state.connected = true;

    selectMemorySession(state, session);
    await loadMemorySessionSummary(state);
    await refreshMemorySessionSummary(state);

    expect(state.summariesSelectedSessionKey).toBe(session.key);
    expect(state.summariesSelectedSessionId).toBe("session-1");
    expect(state.summariesAgentId).toBe("main");
    expect(client.request).toHaveBeenNthCalledWith(1, "memory.sessionSummary.status", {
      agent: "main",
      sessionId: "session-1",
    });
    expect(client.request).toHaveBeenNthCalledWith(2, "memory.sessionSummary.refresh", {
      agent: "main",
      sessionId: "session-1",
      sessionKey: session.key,
      force: true,
    });
    expect(client.request).toHaveBeenNthCalledWith(3, "memory.sessionSummary.status", {
      agent: "main",
      sessionId: "session-1",
    });
    expect(state.summariesRefreshResult?.result.status).toBe("queued");
  });

  it("loads prompt journal summary with parsed day count", async () => {
    const state = createState();
    const client = createClient();
    client.request.mockResolvedValue({
      files: ["/tmp/journal-2026-04-18.jsonl"],
      dateBuckets: ["2026-04-18"],
      totalEvents: 17,
      stageCounts: { prompt_assembly: 10 },
      uniqueSessions: 2,
      promptAssembly: {
        count: 10,
        avgEstimatedTokens: 321,
        avgSystemPromptChars: 1200,
      },
      afterTurn: {
        decisionCounts: { save: 2 },
        skipReasonCounts: { none: 1 },
      },
      durableExtraction: {
        count: 2,
        notesSavedTotal: 2,
        nonZeroSaveCount: 1,
        zeroSaveCount: 1,
        saveRate: 0.5,
        topReasons: [{ reason: "project-state", count: 2 }],
      },
      knowledgeWrite: {
        statusCounts: { saved: 1 },
        actionCounts: { upsert: 1 },
        titles: [{ title: "Project state", count: 1 }],
      },
    });
    state.client = client as unknown as MemoryState["client"];
    state.connected = true;
    state.journalDays = "14";

    await loadMemoryPromptJournal(state);

    expect(client.request).toHaveBeenCalledWith("memory.promptJournal.summary", {
      days: 14,
    });
    expect(state.journalSummary?.promptAssembly.count).toBe(10);
  });
});
