import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  onAgentEvent,
  registerAgentRunContext,
  resetAgentEventsForTest,
  resetAgentRunContextForTest,
} from "../../infra/agent-events.js";
import { emitAgentActionEvent } from "./emit.js";

const mocks = vi.hoisted(() => ({
  getRuntimeConfigSnapshot: vi.fn(),
  loadSessionStore: vi.fn(),
  resolveStorePath: vi.fn(),
  resolveSessionStoreEntry: vi.fn(),
  captureContextArchiveRunEvent: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  getRuntimeConfigSnapshot: mocks.getRuntimeConfigSnapshot,
}));

vi.mock("../../config/sessions.js", () => ({
  loadSessionStore: mocks.loadSessionStore,
  resolveStorePath: mocks.resolveStorePath,
  resolveSessionStoreEntry: mocks.resolveSessionStoreEntry,
}));

vi.mock("../context-archive/run-capture.js", () => ({
  captureContextArchiveRunEvent: mocks.captureContextArchiveRunEvent,
}));

describe("emitAgentActionEvent", () => {
  beforeEach(() => {
    resetAgentEventsForTest();
    resetAgentRunContextForTest();
    mocks.getRuntimeConfigSnapshot.mockReset();
    mocks.loadSessionStore.mockReset();
    mocks.resolveStorePath.mockReset();
    mocks.resolveSessionStoreEntry.mockReset();
    mocks.captureContextArchiveRunEvent.mockReset();
    mocks.captureContextArchiveRunEvent.mockResolvedValue(undefined);
    mocks.getRuntimeConfigSnapshot.mockReturnValue(null);
  });

  afterEach(() => {
    resetAgentEventsForTest();
    resetAgentRunContextForTest();
  });

  it("emits live action events and archives them when run context has a session id", async () => {
    registerAgentRunContext("run-1", {
      sessionKey: "main",
      sessionId: "session-1",
      agentId: "main",
      taskId: "task-1",
    });
    mocks.getRuntimeConfigSnapshot.mockReturnValue({ memory: { contextArchive: { mode: "replay" } } });
    const events: Array<{ stream: string; sessionKey?: string; data: Record<string, unknown> }> = [];
    const stop = onAgentEvent((event) => {
      events.push({
        stream: event.stream,
        sessionKey: event.sessionKey,
        data: event.data,
      });
    });

    try {
      emitAgentActionEvent({
        runId: "run-1",
        data: {
          actionId: "tool:call-1",
          kind: "tool",
          status: "running",
          title: "Running read",
          toolName: "read",
          toolCallId: "call-1",
        },
      });
      await Promise.resolve();
    } finally {
      stop();
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        stream: "action",
        sessionKey: "main",
        data: expect.objectContaining({
          actionId: "tool:call-1",
          kind: "tool",
          status: "running",
          title: "Running read",
        }),
      }),
    );
    expect(mocks.captureContextArchiveRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "action-feed",
        runId: "run-1",
        sessionId: "session-1",
        sessionKey: "main",
        taskId: "task-1",
        agentId: "main",
        type: "agent.action",
        payload: expect.objectContaining({
          action: expect.objectContaining({
            actionId: "tool:call-1",
            kind: "tool",
          }),
        }),
      }),
    );
  });

  it("resolves archive session ids from the session store when only a session key is known", async () => {
    mocks.getRuntimeConfigSnapshot.mockReturnValue({
      session: { store: "/tmp/sessions.json" },
      memory: { contextArchive: { mode: "replay" } },
    });
    mocks.resolveStorePath.mockReturnValue("/tmp/sessions.json");
    mocks.loadSessionStore.mockReturnValue({ main: { sessionId: "session-from-store" } });
    mocks.resolveSessionStoreEntry.mockReturnValue({
      normalizedKey: "main",
      existing: { sessionId: "session-from-store" },
      legacyKeys: [],
    });

    emitAgentActionEvent({
      runId: "approval:123",
      sessionKey: "Main",
      agentId: "main",
      data: {
        actionId: "approval:123",
        kind: "approval",
        status: "waiting",
        title: "Waiting for exec approval",
      },
    });

    await Promise.resolve();

    expect(mocks.resolveStorePath).toHaveBeenCalledWith("/tmp/sessions.json", {
      agentId: "main",
    });
    expect(mocks.captureContextArchiveRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "approval:123",
        sessionId: "session-from-store",
        sessionKey: "main",
        agentId: "main",
      }),
    );
  });
});
