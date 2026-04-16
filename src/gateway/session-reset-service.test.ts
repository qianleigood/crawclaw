import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";

const state = vi.hoisted(() => ({
  cfg: {} as CrawClawConfig,
  store: {} as Record<string, SessionEntry>,
  storePath: "",
  sessionDir: "",
  target: {
    canonicalKey: "agent:main:telegram:direct:123",
    storePath: "",
    storeKeys: ["agent:main:telegram:direct:123"],
    agentId: "main",
  } as {
    canonicalKey: string;
    storePath: string;
    storeKeys: string[];
    agentId: string;
  },
  entry: undefined as SessionEntry | undefined,
}));

const hookRunnerMocks = vi.hoisted(() => ({
  hasHooks: vi.fn<(name: string) => boolean>(() => false),
  runBeforeReset: vi.fn(async () => {}),
  runSubagentEnded: vi.fn(async () => {}),
}));

const resetServiceMocks = vi.hoisted(() => ({
  archiveSessionTranscripts: vi.fn(() => [] as string[]),
  readSessionMessages: vi.fn(() => [] as unknown[]),
  triggerInternalHook: vi.fn(async () => {}),
  clearSessionQueues: vi.fn(() => {}),
  stopSubagentsForRequester: vi.fn(() => ({ stopped: 0 })),
  clearBootstrapSnapshot: vi.fn(() => {}),
  stopSharedDurableExtractionWorkerForSession: vi.fn(async () => {}),
  closeTrackedBrowserTabsForSessions: vi.fn(async () => undefined),
  abortEmbeddedPiRun: vi.fn(() => false),
  waitForEmbeddedPiRunEnd: vi.fn(async () => true),
  unbindBySessionKey: vi.fn(() => {}),
  cancelSession: vi.fn(async () => {}),
  closeSession: vi.fn(async () => {}),
  snapshotSessionOrigin: vi.fn((entry?: SessionEntry) =>
    entry ? { sourceSessionId: entry.sessionId } : undefined,
  ),
}));

let performGatewaySessionReset: typeof import("./session-reset-service.js").performGatewaySessionReset;
let cleanupSessionBeforeMutation: typeof import("./session-reset-service.js").cleanupSessionBeforeMutation;

describe("performGatewaySessionReset", () => {
  beforeEach(async () => {
    vi.resetModules();
    state.sessionDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "crawclaw-reset-"));
    state.storePath = path.join(state.sessionDir, "sessions.json");
    state.cfg = {
      session: { store: state.storePath },
    } as CrawClawConfig;
    state.target = {
      canonicalKey: "agent:main:telegram:direct:123",
      storePath: state.storePath,
      storeKeys: ["agent:main:telegram:direct:123"],
      agentId: "main",
    };
    state.entry = undefined;
    state.store = {};

    hookRunnerMocks.hasHooks.mockReset().mockReturnValue(false);
    hookRunnerMocks.runBeforeReset.mockReset().mockResolvedValue(undefined);
    hookRunnerMocks.runSubagentEnded.mockReset().mockResolvedValue(undefined);
    resetServiceMocks.archiveSessionTranscripts.mockReset().mockReturnValue([]);
    resetServiceMocks.readSessionMessages.mockReset().mockReturnValue([]);
    resetServiceMocks.triggerInternalHook.mockReset().mockResolvedValue(undefined);
    resetServiceMocks.clearSessionQueues.mockReset();
    resetServiceMocks.stopSubagentsForRequester.mockReset().mockReturnValue({ stopped: 0 });
    resetServiceMocks.clearBootstrapSnapshot.mockReset();
    resetServiceMocks.stopSharedDurableExtractionWorkerForSession
      .mockReset()
      .mockResolvedValue(undefined);
    resetServiceMocks.closeTrackedBrowserTabsForSessions.mockReset().mockResolvedValue(undefined);
    resetServiceMocks.abortEmbeddedPiRun.mockReset().mockReturnValue(false);
    resetServiceMocks.waitForEmbeddedPiRunEnd.mockReset().mockResolvedValue(true);
    resetServiceMocks.unbindBySessionKey.mockReset();
    resetServiceMocks.cancelSession.mockReset().mockResolvedValue(undefined);
    resetServiceMocks.closeSession.mockReset().mockResolvedValue(undefined);
    resetServiceMocks.snapshotSessionOrigin.mockClear();

    vi.doMock("../config/config.js", () => ({
      loadConfig: () => state.cfg,
    }));

    vi.doMock("../config/sessions.js", () => ({
      updateSessionStore: async (
        _storePath: string,
        mutator: (store: Record<string, SessionEntry>) => SessionEntry,
      ) => mutator(state.store),
      snapshotSessionOrigin: resetServiceMocks.snapshotSessionOrigin,
    }));

    vi.doMock("../config/sessions/paths.js", () => ({
      resolveSessionFilePath: (sessionId: string) =>
        path.join(state.sessionDir, `${sessionId}.jsonl`),
      resolveSessionFilePathOptions: () => ({}),
    }));

    vi.doMock("../agents/agent-scope.js", () => ({
      resolveAgentWorkspaceDir: () => "/tmp/crawclaw-agent-workspace",
      resolveDefaultAgentId: () => "main",
    }));

    vi.doMock("../hooks/internal-hooks.js", () => ({
      createInternalHookEvent: () => ({ messages: [] }),
      triggerInternalHook: resetServiceMocks.triggerInternalHook,
    }));

    vi.doMock("../plugins/hook-runner-global.js", () => ({
      getGlobalHookRunner: () => ({
        hasHooks: hookRunnerMocks.hasHooks,
        runBeforeReset: hookRunnerMocks.runBeforeReset,
        runSubagentEnded: hookRunnerMocks.runSubagentEnded,
      }),
    }));

    vi.doMock("../plugins/runtime/index.js", () => ({
      createPluginRuntime: () => ({
        channel: {
          discord: {
            threadBindings: {
              unbindBySessionKey: resetServiceMocks.unbindBySessionKey,
            },
          },
        },
      }),
    }));

    vi.doMock("../agents/bootstrap-cache.js", () => ({
      clearBootstrapSnapshot: resetServiceMocks.clearBootstrapSnapshot,
    }));

    vi.doMock("../auto-reply/reply/abort.js", () => ({
      stopSubagentsForRequester: resetServiceMocks.stopSubagentsForRequester,
    }));

    vi.doMock("../auto-reply/reply/queue.js", () => ({
      clearSessionQueues: resetServiceMocks.clearSessionQueues,
    }));

    vi.doMock("../memory/durable/worker-manager.ts", () => ({
      stopSharedDurableExtractionWorkerForSession:
        resetServiceMocks.stopSharedDurableExtractionWorkerForSession,
    }));

    vi.doMock("../plugin-sdk/browser-maintenance.js", () => ({
      closeTrackedBrowserTabsForSessions: resetServiceMocks.closeTrackedBrowserTabsForSessions,
    }));

    vi.doMock("../agents/pi-embedded.js", () => ({
      abortEmbeddedPiRun: resetServiceMocks.abortEmbeddedPiRun,
      waitForEmbeddedPiRunEnd: resetServiceMocks.waitForEmbeddedPiRunEnd,
    }));

    vi.doMock("../acp/control-plane/manager.js", () => ({
      getAcpSessionManager: () => ({
        cancelSession: resetServiceMocks.cancelSession,
        closeSession: resetServiceMocks.closeSession,
      }),
    }));

    vi.doMock("../sessions/transcript-archive.fs.js", () => ({
      archiveSessionTranscripts: resetServiceMocks.archiveSessionTranscripts,
    }));

    vi.doMock("./session-utils.js", () => ({
      archiveSessionTranscripts: resetServiceMocks.archiveSessionTranscripts,
      loadSessionEntry: () => ({
        entry: state.entry,
        legacyKey: undefined,
        canonicalKey: state.target.canonicalKey,
      }),
      migrateAndPruneGatewaySessionStoreKey: () => ({ primaryKey: state.target.canonicalKey }),
      readSessionMessages: resetServiceMocks.readSessionMessages,
      resolveGatewaySessionStoreTarget: () => state.target,
      resolveSessionModelRef: () => ({ provider: "anthropic", model: "claude-sonnet-4" }),
    }));

    ({ performGatewaySessionReset, cleanupSessionBeforeMutation } =
      await import("./session-reset-service.js"));
  });

  it("rotates the session while preserving user-facing settings and clearing runtime state", async () => {
    const oldSessionFile = path.join(state.sessionDir, "existing.jsonl");
    state.entry = {
      sessionId: "old-session-id",
      sessionFile: oldSessionFile,
      updatedAt: 1_700_000_000_000,
      systemSent: true,
      abortedLastRun: true,
      thinkingLevel: "high",
      fastMode: true,
      verboseLevel: "full",
      reasoningLevel: "on",
      elevatedLevel: "auto",
      ttsAuto: "always",
      execHost: "host-a",
      responseUsage: "full",
      providerOverride: "openai",
      modelOverride: "gpt-5.4",
      authProfileOverride: "owner",
      queueMode: "collect",
      queueDebounceMs: 300,
      queueCap: 9,
      queueDrop: "summarize",
      spawnedBy: "agent:main:telegram:direct:parent",
      spawnedWorkspaceDir: "/tmp/inherited-workspace",
      parentSessionKey: "agent:main:telegram:direct:parent",
      spawnDepth: 2,
      subagentRole: "leaf",
      subagentControlScope: "children",
      label: "Pinned",
      displayName: "Pinned Display",
      channel: "telegram",
      lastChannel: "telegram",
      lastTo: "telegram:user",
      lastThreadId: "topic-1",
      skillsSnapshot: { version: 1 } as never,
      inputTokens: 42,
      outputTokens: 84,
      totalTokens: 126,
      totalTokensFresh: false,
      contextTokens: 1234,
      model: "stale-model",
      modelProvider: "stale-provider",
    } as SessionEntry;
    state.store[state.target.canonicalKey] = { ...state.entry };

    const result = await performGatewaySessionReset({
      key: state.target.canonicalKey,
      reason: "reset",
      commandSource: "gateway:sessions.reset",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.key).toBe(state.target.canonicalKey);
    expect(result.entry.sessionId).not.toBe("old-session-id");
    expect(result.entry.sessionFile).toMatch(/\.jsonl$/);
    expect(result.entry.systemSent).toBe(false);
    expect(result.entry.abortedLastRun).toBe(false);
    expect(result.entry.thinkingLevel).toBe("high");
    expect(result.entry.fastMode).toBe(true);
    expect(result.entry.verboseLevel).toBe("full");
    expect(result.entry.reasoningLevel).toBe("on");
    expect(result.entry.elevatedLevel).toBe("auto");
    expect(result.entry.ttsAuto).toBe("always");
    expect(result.entry.execHost).toBe("host-a");
    expect(result.entry.providerOverride).toBe("openai");
    expect(result.entry.modelOverride).toBe("gpt-5.4");
    expect(result.entry.authProfileOverride).toBe("owner");
    expect(result.entry.queueMode).toBe("collect");
    expect(result.entry.queueDebounceMs).toBe(300);
    expect(result.entry.queueCap).toBe(9);
    expect(result.entry.queueDrop).toBe("summarize");
    expect(result.entry.spawnedBy).toBe("agent:main:telegram:direct:parent");
    expect(result.entry.parentSessionKey).toBe("agent:main:telegram:direct:parent");
    expect(result.entry.spawnDepth).toBe(2);
    expect(result.entry.subagentRole).toBe("leaf");
    expect(result.entry.label).toBe("Pinned");
    expect(result.entry.displayName).toBe("Pinned Display");
    expect(result.entry.modelProvider).toBe("anthropic");
    expect(result.entry.model).toBe("claude-sonnet-4");
    expect(result.entry.inputTokens).toBe(0);
    expect(result.entry.outputTokens).toBe(0);
    expect(result.entry.totalTokens).toBe(0);
    expect(result.entry.totalTokensFresh).toBe(true);
    expect(result.entry.contextTokens).toBeUndefined();
    expect(result.entry.origin).toEqual({ sourceSessionId: "old-session-id" });
    expect(state.store[state.target.canonicalKey]).toEqual(result.entry);
    expect(resetServiceMocks.archiveSessionTranscripts).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "old-session-id",
        storePath: state.storePath,
        sessionFile: oldSessionFile,
        reason: "reset",
      }),
    );
    expect(fs.existsSync(result.entry.sessionFile ?? "")).toBe(true);
    const transcriptHeader = JSON.parse(
      fs.readFileSync(result.entry.sessionFile as string, "utf-8").split("\n")[0] ?? "{}",
    ) as { id?: string; type?: string };
    expect(transcriptHeader).toMatchObject({
      type: "session",
      id: result.entry.sessionId,
    });
  });

  it("fires before_reset hooks and unbinds the old session when resetting an existing entry", async () => {
    state.entry = {
      sessionId: "old-session-id",
      sessionFile: path.join(state.sessionDir, "existing.jsonl"),
      updatedAt: Date.now(),
      acp: undefined,
    } as SessionEntry;
    state.store[state.target.canonicalKey] = { ...state.entry };
    hookRunnerMocks.hasHooks.mockImplementation((name) => name === "before_reset");
    resetServiceMocks.readSessionMessages.mockReturnValue([{ role: "user", content: "before" }]);

    const result = await performGatewaySessionReset({
      key: state.target.canonicalKey,
      reason: "new",
      commandSource: "gateway:sessions.reset",
    });

    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(hookRunnerMocks.runBeforeReset).toHaveBeenCalledTimes(1));
    expect(hookRunnerMocks.runBeforeReset).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionFile: state.entry.sessionFile,
        messages: [{ role: "user", content: "before" }],
        reason: "new",
      }),
      expect.objectContaining({
        agentId: "main",
        sessionKey: state.target.canonicalKey,
        sessionId: "old-session-id",
        workspaceDir: "/tmp/crawclaw-agent-workspace",
      }),
    );
    expect(resetServiceMocks.unbindBySessionKey).toHaveBeenCalledWith(
      expect.objectContaining({
        targetSessionKey: state.target.canonicalKey,
        reason: "session-reset",
      }),
    );
  });

  it("returns unavailable when the active embedded run does not stop during cleanup", async () => {
    resetServiceMocks.waitForEmbeddedPiRunEnd.mockResolvedValue(false);

    const result = await cleanupSessionBeforeMutation({
      cfg: state.cfg,
      key: state.target.canonicalKey,
      target: state.target,
      entry: {
        sessionId: "active-session",
        updatedAt: Date.now(),
      } as SessionEntry,
      reason: "session-reset",
    });

    expect(result).toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("still active"),
    });
    expect(resetServiceMocks.abortEmbeddedPiRun).toHaveBeenCalledWith("active-session");
    expect(resetServiceMocks.clearSessionQueues).toHaveBeenCalled();
    expect(resetServiceMocks.clearBootstrapSnapshot).toHaveBeenCalledWith(
      state.target.canonicalKey,
    );
  });

  it("cancels and closes ACP runtimes during cleanup when the session carries ACP metadata", async () => {
    const result = await cleanupSessionBeforeMutation({
      cfg: state.cfg,
      key: state.target.canonicalKey,
      target: state.target,
      entry: {
        sessionId: "acp-session",
        updatedAt: Date.now(),
        acp: {
          backend: "local",
          agent: "main",
          runtimeSessionName: "acp-runtime",
          mode: "persistent",
          state: "idle",
          lastActivityAt: Date.now(),
        },
      } as SessionEntry,
      reason: "session-delete",
    });

    expect(result).toBeUndefined();
    expect(resetServiceMocks.cancelSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: state.cfg,
        sessionKey: state.target.canonicalKey,
        reason: "session-delete",
      }),
    );
    expect(resetServiceMocks.closeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: state.cfg,
        sessionKey: state.target.canonicalKey,
        reason: "session-delete",
        requireAcpSession: false,
        allowBackendUnavailable: true,
      }),
    );
  });
});
