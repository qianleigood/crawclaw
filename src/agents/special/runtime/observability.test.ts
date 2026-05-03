import { describe, expect, it, vi } from "vitest";
import { buildSpecialAgentUsageDetail, createSpecialAgentObservability } from "./observability.js";
import type { SpecialAgentDefinition } from "./types.js";

const TEST_DEFINITION: SpecialAgentDefinition = {
  id: "test_special_agent",
  label: "test-special-agent",
  spawnSource: "test-special-agent",
  executionMode: "embedded_fork",
  transcriptPolicy: "isolated",
  parentContextPolicy: "none",
  toolPolicy: {
    allowlist: ["read"],
    enforcement: "runtime_deny",
  },
  mode: "run",
  cleanup: "keep",
  sandbox: "inherit",
  expectsCompletionMessage: false,
};

describe("special-agent observability", () => {
  it("records embedded special-agent events, history, usage, and completion into the archive capture", async () => {
    const appendEvent = vi.fn().mockResolvedValue("evt-1");
    const updateRunState = vi.fn().mockResolvedValue("run-1");
    const createContextArchiveRunCapture = vi.fn().mockReturnValue({
      appendEvent,
      updateRunState,
      reset: vi.fn(),
    });
    const resolveSharedContextArchiveService = vi.fn().mockResolvedValue({});
    const observability = createSpecialAgentObservability(
      {
        definition: TEST_DEFINITION,
        sessionId: "session-1",
        sessionKey: "agent:main:session-1",
        agentId: "main",
        parentRunId: "parent-run-1",
      },
      {
        resolveSharedContextArchiveService,
        createContextArchiveRunCapture,
      },
    );

    await observability.hooks.onAgentEvent?.({
      runId: "special-run-1",
      seq: 1,
      stream: "assistant",
      ts: 123,
      data: { text: "partial" },
    });
    await observability.hooks.onHistory?.({
      runId: "special-run-1",
      childSessionKey: "embedded:test:special-run-1",
      messages: [{ role: "assistant", text: "done" }],
    });
    await observability.hooks.onUsage?.({
      runId: "special-run-1",
      childSessionKey: "embedded:test:special-run-1",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 3,
        cacheWrite: 2,
        total: 20,
      },
    });
    await observability.recordResult({
      result: {
        status: "completed",
        runId: "special-run-1",
        childSessionKey: "embedded:test:special-run-1",
        reply: "STATUS: OK",
        endedAt: 456,
        usage: {
          input: 10,
          output: 5,
          cacheRead: 3,
          cacheWrite: 2,
          total: 20,
        },
        historyMessageCount: 1,
      },
      summary: "finished",
      detail: {
        writtenCount: 1,
      },
    });

    expect(resolveSharedContextArchiveService).toHaveBeenCalledTimes(1);
    expect(createContextArchiveRunCapture).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        source: "special-agent-runtime",
        runId: "special-run-1",
        sessionId: "session-1",
        sessionKey: "agent:main:session-1",
        agentId: "main",
        label: "test-special-agent",
        kind: "task",
        type: "special_agent.event.assistant",
        metadata: expect.objectContaining({
          definitionId: "test_special_agent",
          spawnSource: "test-special-agent",
          executionMode: "embedded_fork",
          parentRunId: "parent-run-1",
          stream: "assistant",
        }),
      }),
    );
    expect(appendEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: "special_agent.usage",
        payload: {
          childSessionKey: "embedded:test:special-run-1",
          usage: {
            input: 10,
            output: 5,
            cacheRead: 3,
            cacheWrite: 2,
            total: 20,
          },
        },
        metadata: expect.objectContaining({
          cacheRead: 3,
          cacheWrite: 2,
        }),
      }),
    );
    expect(updateRunState).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "special-agent-runtime",
        runId: "special-run-1",
        status: "complete",
        summary: expect.objectContaining({
          specialAgentStatus: "completed",
          summary: "finished",
          usage: {
            input: 10,
            output: 5,
            cacheRead: 3,
            cacheWrite: 2,
            total: 20,
          },
          historyMessageCount: 1,
        }),
      }),
    );
  });

  it("adds usage and history details only when present", () => {
    expect(
      buildSpecialAgentUsageDetail({
        usage: {
          input: 12,
          cacheRead: 4,
          cacheWrite: 1,
          total: 17,
        },
        historyMessageCount: 3,
      }),
    ).toEqual({
      usage: {
        input: 12,
        cacheRead: 4,
        cacheWrite: 1,
        total: 17,
      },
      historyMessageCount: 3,
    });
    expect(buildSpecialAgentUsageDetail({})).toBeUndefined();
  });
});
