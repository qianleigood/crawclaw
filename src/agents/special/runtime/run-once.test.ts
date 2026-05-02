import { describe, expect, it, vi } from "vitest";
import { PROMOTION_JUDGE_AGENT_DEFINITION } from "../../../improvement/promotion-judge.js";
import { DURABLE_MEMORY_AGENT_DEFINITION } from "../../../memory/durable/agent-runner.js";
import { buildSpecialAgentCacheEnvelope } from "./parent-fork-context.js";
import { runSpecialAgentToCompletion } from "./run-once.js";
import type { SpecialAgentDefinition } from "./types.js";

const TEST_SPECIAL_AGENT_DEFINITION: SpecialAgentDefinition = {
  id: "test_special_agent",
  label: "test-special-agent",
  spawnSource: "test-special-agent",
  transcriptPolicy: "isolated",
  toolPolicy: { allowlist: ["read"] },
  mode: "run",
  cleanup: "keep",
  sandbox: "inherit",
  expectsCompletionMessage: false,
  defaultRunTimeoutSeconds: 90,
  defaultMaxTurns: 5,
};

const TEST_SPECIAL_AGENT_WITH_CACHE_DEFINITION: SpecialAgentDefinition = {
  ...TEST_SPECIAL_AGENT_DEFINITION,
  id: "test_special_agent_with_cache",
  spawnSource: "test-special-agent-cache",
  cachePolicy: {
    cacheRetention: "short",
    skipWrite: true,
  },
};

const TEST_EMBEDDED_SPECIAL_AGENT_DEFINITION: SpecialAgentDefinition = {
  ...TEST_SPECIAL_AGENT_WITH_CACHE_DEFINITION,
  id: "test_embedded_special_agent",
  label: "test-embedded-special-agent",
  spawnSource: "test-embedded-special-agent",
  executionMode: "embedded_fork",
  toolPolicy: {
    allowlist: ["read"],
    enforcement: "prompt_allowlist",
  },
};

const TEST_EMBEDDED_RUNTIME_DENY_SPECIAL_AGENT_DEFINITION: SpecialAgentDefinition = {
  ...TEST_EMBEDDED_SPECIAL_AGENT_DEFINITION,
  id: "test_embedded_runtime_deny_special_agent",
  label: "test-embedded-runtime-deny-special-agent",
  spawnSource: "test-embedded-runtime-deny-special-agent",
  toolPolicy: {
    allowlist: ["read"],
    enforcement: "runtime_deny",
  },
};

describe("runSpecialAgentToCompletion", () => {
  it("returns spawn_failed when the child agent cannot be started", async () => {
    const result = await runSpecialAgentToCompletion(
      {
        definition: TEST_SPECIAL_AGENT_DEFINITION,
        task: "do the thing",
      },
      {
        spawnAgentSessionDirect: vi.fn().mockResolvedValue({
          status: "error",
          error: "pairing required",
        }),
        captureSubagentCompletionReply: vi.fn(),
        callGateway: vi.fn(),
        onAgentEvent: vi.fn(),
        runEmbeddedPiAgent: vi.fn(),
      },
    );

    expect(result).toEqual({
      status: "spawn_failed",
      error: "pairing required",
    });
  });

  it("rejects invalid special-agent contract combinations before execution", async () => {
    const invalidDefinition: SpecialAgentDefinition = {
      ...TEST_SPECIAL_AGENT_DEFINITION,
      executionMode: "embedded_fork",
      transcriptPolicy: "thread_bound",
      toolPolicy: {
        allowlist: ["read"],
      },
    };

    const result = await runSpecialAgentToCompletion(
      {
        definition: invalidDefinition,
        task: "do the thing",
      },
      {
        spawnAgentSessionDirect: vi.fn(),
        captureSubagentCompletionReply: vi.fn(),
        callGateway: vi.fn(),
        onAgentEvent: vi.fn(),
        runEmbeddedPiAgent: vi.fn(),
      },
    );

    expect(result).toEqual({
      status: "spawn_failed",
      error: expect.stringContaining("invalid special agent contract"),
    });
  });

  it("returns wait_failed when the child agent run times out", async () => {
    const deps = {
      spawnAgentSessionDirect: vi.fn().mockResolvedValue({
        status: "accepted",
        runId: "run-special-1",
        childSessionKey: "agent:main:subagent:special-1",
      }),
      captureSubagentCompletionReply: vi.fn(),
      callGateway: vi.fn().mockResolvedValue({
        status: "timeout",
      }),
      onAgentEvent: vi.fn(),
      runEmbeddedPiAgent: vi.fn(),
    };

    const result = await runSpecialAgentToCompletion(
      {
        definition: TEST_SPECIAL_AGENT_DEFINITION,
        task: "do the thing",
      },
      deps,
    );

    expect(result).toEqual({
      status: "wait_failed",
      error: "timeout",
      runId: "run-special-1",
      childSessionKey: "agent:main:subagent:special-1",
      waitStatus: "timeout",
    });
    expect(deps.callGateway).toHaveBeenCalledWith({
      method: "agent.wait",
      params: {
        runId: "run-special-1",
        timeoutMs: 100_000,
      },
      timeoutMs: 110_000,
    });
  });

  it("uses the shared definition defaults and returns the completion reply", async () => {
    const deps = {
      spawnAgentSessionDirect: vi.fn().mockResolvedValue({
        status: "accepted",
        runId: "run-special-2",
        childSessionKey: "agent:main:subagent:special-2",
      }),
      captureSubagentCompletionReply: vi.fn().mockResolvedValue("STATUS: OK"),
      callGateway: vi.fn().mockResolvedValue({
        status: "ok",
        endedAt: 123,
      }),
      onAgentEvent: vi.fn().mockReturnValue(() => {}),
      runEmbeddedPiAgent: vi.fn(),
    };

    const result = await runSpecialAgentToCompletion(
      {
        definition: TEST_SPECIAL_AGENT_DEFINITION,
        task: "do the thing",
        extraSystemPrompt: "system prompt",
        spawnContext: {
          agentSessionKey: "agent:main:session-1",
          requesterAgentIdOverride: "main",
        },
        spawnOverrides: {
          maxTurns: 7,
        },
      },
      deps,
    );

    expect(deps.spawnAgentSessionDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "subagent",
        task: "do the thing",
        label: "test-special-agent",
        mode: "run",
        cleanup: "keep",
        sandbox: "inherit",
        spawnSource: "test-special-agent",
        expectsCompletionMessage: false,
        extraSystemPrompt: "system prompt",
        runTimeoutSeconds: 90,
        maxTurns: 7,
      }),
      {
        agentSessionKey: "agent:main:session-1",
        requesterAgentIdOverride: "main",
      },
    );
    expect(result).toEqual({
      status: "completed",
      runId: "run-special-2",
      childSessionKey: "agent:main:subagent:special-2",
      reply: "STATUS: OK",
      endedAt: 123,
    });
  });

  it("forces isolated special agents to run without thread binding or session resume", async () => {
    const deps = {
      spawnAgentSessionDirect: vi.fn().mockResolvedValue({
        status: "accepted",
        runId: "run-special-3",
        childSessionKey: "agent:main:subagent:special-3",
      }),
      captureSubagentCompletionReply: vi.fn().mockResolvedValue("STATUS: OK"),
      callGateway: vi.fn().mockResolvedValue({
        status: "ok",
        endedAt: 321,
      }),
      onAgentEvent: vi.fn().mockReturnValue(() => {}),
      runEmbeddedPiAgent: vi.fn(),
    };

    await runSpecialAgentToCompletion(
      {
        definition: TEST_SPECIAL_AGENT_DEFINITION,
        task: "do the thing",
        spawnOverrides: {
          thread: true,
          mode: "session",
          resumeSessionId: "resume-me",
          streamTo: "parent",
        },
      },
      deps,
    );

    expect(deps.spawnAgentSessionDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "run",
      }),
      undefined,
    );
    expect(deps.spawnAgentSessionDirect.mock.calls[0]?.[0]).not.toHaveProperty("thread");
    expect(deps.spawnAgentSessionDirect.mock.calls[0]?.[0]).not.toHaveProperty("resumeSessionId");
    expect(deps.spawnAgentSessionDirect.mock.calls[0]?.[0]).not.toHaveProperty("streamTo");
  });

  it("derives shared cache stream params from the special-agent cache policy", async () => {
    const deps = {
      spawnAgentSessionDirect: vi.fn().mockResolvedValue({
        status: "accepted",
        runId: "run-special-3b",
        childSessionKey: "agent:main:subagent:special-3b",
      }),
      captureSubagentCompletionReply: vi.fn().mockResolvedValue("STATUS: OK"),
      callGateway: vi.fn().mockResolvedValue({
        status: "ok",
        endedAt: 333,
      }),
      onAgentEvent: vi.fn().mockReturnValue(() => {}),
      runEmbeddedPiAgent: vi.fn(),
    };

    await runSpecialAgentToCompletion(
      {
        definition: TEST_SPECIAL_AGENT_WITH_CACHE_DEFINITION,
        task: "do the thing",
        spawnContext: {
          agentSessionKey: "agent:main:session-2",
        },
      },
      deps,
    );

    expect(deps.spawnAgentSessionDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        streamParams: {
          cacheRetention: "short",
          skipCacheWrite: true,
        },
      }),
      expect.objectContaining({
        agentSessionKey: "agent:main:session-2",
      }),
    );
  });

  it("forwards run events and derived usage through shared hooks", async () => {
    const unsubscribe = vi.fn();
    const onAgentEvent = vi.fn().mockReturnValue(unsubscribe);
    const callGateway = vi
      .fn()
      .mockResolvedValueOnce({
        status: "ok",
        endedAt: 222,
      })
      .mockResolvedValueOnce({
        messages: [
          {
            role: "assistant",
            usage: {
              input: 10,
              output: 5,
              total: 15,
            },
          },
        ],
      });
    const deps = {
      spawnAgentSessionDirect: vi.fn().mockResolvedValue({
        status: "accepted",
        runId: "run-special-4",
        childSessionKey: "agent:main:subagent:special-4",
      }),
      captureSubagentCompletionReply: vi.fn().mockResolvedValue("STATUS: OK"),
      callGateway,
      onAgentEvent,
      runEmbeddedPiAgent: vi.fn(),
    };
    const historyHook = vi.fn();
    const usageHook = vi.fn();
    const eventHook = vi.fn();

    const runPromise = runSpecialAgentToCompletion(
      {
        definition: TEST_SPECIAL_AGENT_DEFINITION,
        task: "do the thing",
        hooks: {
          onAgentEvent: eventHook,
          onHistory: historyHook,
          onUsage: usageHook,
        },
      },
      deps,
    );

    await vi.waitFor(() => {
      expect(onAgentEvent).toHaveBeenCalledTimes(1);
    });
    const listener = onAgentEvent.mock.calls[0]?.[0] as ((event: unknown) => void) | undefined;
    listener?.({
      runId: "run-special-4",
      seq: 1,
      stream: "assistant",
      ts: 100,
      data: { text: "partial" },
    });
    listener?.({
      runId: "other-run",
      seq: 2,
      stream: "assistant",
      ts: 101,
      data: { text: "ignore" },
    });

    const result = await runPromise;

    expect(eventHook).toHaveBeenCalledTimes(1);
    expect(historyHook).toHaveBeenCalledWith({
      runId: "run-special-4",
      childSessionKey: "agent:main:subagent:special-4",
      messages: [{ role: "assistant", usage: { input: 10, output: 5, total: 15 } }],
    });
    expect(usageHook).toHaveBeenCalledWith({
      runId: "run-special-4",
      childSessionKey: "agent:main:subagent:special-4",
      usage: {
        input: 10,
        output: 5,
        total: 15,
      },
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(callGateway).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "chat.history",
        params: {
          sessionKey: "agent:main:subagent:special-4",
          limit: 100,
        },
      }),
    );
    expect(result).toEqual({
      status: "completed",
      runId: "run-special-4",
      childSessionKey: "agent:main:subagent:special-4",
      reply: "STATUS: OK",
      endedAt: 222,
      usage: {
        input: 10,
        output: 5,
        total: 15,
      },
      historyMessageCount: 1,
    });
  });

  it("dispatches embedded_fork definitions through the embedded runner substrate", async () => {
    const parentPromptEnvelope = buildSpecialAgentCacheEnvelope({
      systemPromptText: "system prompt",
      toolPromptPayload: [],
      thinkingConfig: {},
      forkContextMessages: [],
    });
    const runEmbeddedPiAgent = vi.fn(async (params: Record<string, unknown>) => {
      const onAgentEvent = params.onAgentEvent as
        | ((event: { stream: string; data: Record<string, unknown> }) => void)
        | undefined;
      onAgentEvent?.({
        stream: "assistant",
        data: { text: "partial" },
      });
      return {
        payloads: [{ text: "STATUS: OK" }, { text: "internal reasoning", isReasoning: true }],
        meta: {
          durationMs: 12,
          agentMeta: {
            sessionId: "session-embedded-1",
            provider: "openai",
            model: "gpt-5.4",
            usage: {
              input: 3,
              output: 2,
              total: 5,
            },
          },
        },
      };
    });
    const deps = {
      spawnAgentSessionDirect: vi.fn(),
      captureSubagentCompletionReply: vi.fn(),
      callGateway: vi.fn(),
      onAgentEvent: vi.fn(),
      runEmbeddedPiAgent,
    };
    const historyHook = vi.fn();
    const usageHook = vi.fn();
    const eventHook = vi.fn();

    const result = await runSpecialAgentToCompletion(
      {
        definition: TEST_EMBEDDED_SPECIAL_AGENT_DEFINITION,
        task: "do the embedded thing",
        extraSystemPrompt: "embedded system prompt",
        parentForkContext: {
          parentRunId: "parent-run-embedded-1",
          provider: "openai",
          modelId: "gpt-5.4",
          promptEnvelope: parentPromptEnvelope,
        },
        embeddedContext: {
          sessionId: "session-embedded-1",
          sessionKey: "agent:main:main",
          sessionFile: "/tmp/crawclaw-embedded-session.jsonl",
          workspaceDir: "/tmp/crawclaw-embedded",
          agentId: "main",
          provider: "openai",
          model: "gpt-5.4",
        },
        hooks: {
          onAgentEvent: eventHook,
          onHistory: historyHook,
          onUsage: usageHook,
        },
      },
      deps,
    );

    expect(deps.spawnAgentSessionDirect).not.toHaveBeenCalled();
    expect(runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.stringMatching(
          /^embedded-test_embedded_special_agent-special-test_embedded_special_agent-/,
        ),
        sessionKey: expect.stringMatching(
          /^embedded:test_embedded_special_agent:special:test_embedded_special_agent:/,
        ),
        sessionFile: expect.stringMatching(
          /\/tmp\/embedded-test_embedded_special_agent-special-test_embedded_special_agent-.*\.jsonl$/,
        ),
        workspaceDir: "/tmp/crawclaw-embedded",
        prompt: "do the embedded thing",
        extraSystemPrompt: "embedded system prompt",
        provider: "openai",
        model: "gpt-5.4",
        toolsAllow: ["read"],
        specialParentPromptEnvelope: expect.objectContaining({
          systemPromptText: "system prompt",
          toolPromptPayload: [],
          thinkingConfig: {},
          forkContextMessages: [],
        }),
        specialAgentSpawnSource: "test-embedded-special-agent",
        streamParams: {
          cacheRetention: "short",
          skipCacheWrite: true,
        },
      }),
    );
    const embeddedRunId = (runEmbeddedPiAgent.mock.calls[0]?.[0] as { runId?: string } | undefined)
      ?.runId;
    expect(typeof embeddedRunId).toBe("string");
    const embeddedParams = runEmbeddedPiAgent.mock.calls[0]?.[0] as
      | { sessionId?: string; sessionFile?: string }
      | undefined;
    expect(embeddedParams?.sessionId).not.toBe("session-embedded-1");
    expect(embeddedParams?.sessionFile).not.toBe("/tmp/crawclaw-embedded-session.jsonl");
    expect(eventHook).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: embeddedRunId,
        seq: 1,
        stream: "assistant",
        data: { text: "partial" },
        sessionKey: `embedded:test_embedded_special_agent:${embeddedRunId}`,
      }),
    );
    expect(historyHook).toHaveBeenCalledWith({
      runId: embeddedRunId,
      childSessionKey: `embedded:test_embedded_special_agent:${embeddedRunId}`,
      messages: [
        { role: "assistant", text: "STATUS: OK" },
        { role: "assistant", text: "internal reasoning", isReasoning: true },
      ],
    });
    expect(usageHook).toHaveBeenCalledWith({
      runId: embeddedRunId,
      childSessionKey: `embedded:test_embedded_special_agent:${embeddedRunId}`,
      usage: {
        input: 3,
        output: 2,
        total: 5,
      },
    });
    expect(result).toEqual({
      status: "completed",
      runId: embeddedRunId,
      childSessionKey: `embedded:test_embedded_special_agent:${embeddedRunId}`,
      reply: "STATUS: OK",
      endedAt: expect.any(Number),
      usage: {
        input: 3,
        output: 2,
        total: 5,
      },
      historyMessageCount: 2,
    });
  });

  it("ignores synthetic manual parent model refs for embedded fork model selection", async () => {
    const parentPromptEnvelope = buildSpecialAgentCacheEnvelope({
      systemPromptText: "manual refresh context",
      toolPromptPayload: [],
      thinkingConfig: {},
      forkContextMessages: [{ role: "user", content: "summarize persisted messages" }],
    });
    const runEmbeddedPiAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "STATUS: OK" }],
      meta: { durationMs: 1, agentMeta: { usage: { input: 1, output: 1, total: 2 } } },
    });

    await runSpecialAgentToCompletion(
      {
        definition: TEST_EMBEDDED_SPECIAL_AGENT_DEFINITION,
        task: "refresh summary",
        parentForkContext: {
          parentRunId: "manual-session-summary:session-1",
          provider: "manual",
          modelId: "session-summary-refresh",
          promptEnvelope: parentPromptEnvelope,
        },
        embeddedContext: {
          sessionId: "session-embedded-manual",
          sessionKey: "agent:main:main",
          sessionFile: "/tmp/crawclaw-manual-refresh-session.jsonl",
          workspaceDir: "/tmp/crawclaw-manual-refresh",
          agentId: "main",
          config: {
            agents: { defaults: { model: { primary: "openai/gpt-5.4" } } },
          },
        },
      },
      {
        spawnAgentSessionDirect: vi.fn(),
        captureSubagentCompletionReply: vi.fn(),
        callGateway: vi.fn(),
        onAgentEvent: vi.fn(),
        runEmbeddedPiAgent,
      },
    );

    expect(runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-5.4",
      }),
    );
  });

  it("uses explicit parent prompt tool inventory for embedded runtime_deny agents", async () => {
    const parentPromptEnvelope = buildSpecialAgentCacheEnvelope({
      systemPromptText: "system prompt",
      toolNames: ["read", "exec"],
      toolPromptPayload: [{ name: "read" }, { name: "exec" }],
    });
    const runEmbeddedPiAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "STATUS: OK" }],
      meta: { durationMs: 1, agentMeta: { usage: { input: 1, output: 1, total: 2 } } },
    });

    await runSpecialAgentToCompletion(
      {
        definition: TEST_EMBEDDED_RUNTIME_DENY_SPECIAL_AGENT_DEFINITION,
        task: "do the embedded thing",
        parentForkContext: {
          parentRunId: "parent-run-embedded-2",
          provider: "openai",
          modelId: "gpt-5.4",
          promptEnvelope: parentPromptEnvelope,
        },
        embeddedContext: {
          sessionId: "session-embedded-2",
          sessionKey: "agent:main:main",
          sessionFile: "/tmp/crawclaw-embedded-session-2.jsonl",
          workspaceDir: "/tmp/crawclaw-embedded-2",
          agentId: "main",
          provider: "openai",
          model: "gpt-5.4",
        },
      },
      {
        spawnAgentSessionDirect: vi.fn(),
        captureSubagentCompletionReply: vi.fn(),
        callGateway: vi.fn(),
        onAgentEvent: vi.fn(),
        runEmbeddedPiAgent,
      },
    );

    const params = runEmbeddedPiAgent.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(params?.toolsAllow).toBeUndefined();
    expect(params?.specialParentPromptEnvelope).toEqual(
      expect.objectContaining({
        toolPromptPayload: [{ name: "read" }, { name: "exec" }],
      }),
    );
  });

  it("surfaces only the verdict tool for promotion-judge embedded runs", async () => {
    const runEmbeddedPiAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "STATUS: OK" }],
      meta: { durationMs: 1, agentMeta: { usage: { input: 1, output: 1, total: 2 } } },
    });

    await runSpecialAgentToCompletion(
      {
        definition: PROMOTION_JUDGE_AGENT_DEFINITION,
        task: "review the candidate",
        embeddedContext: {
          sessionId: "session-promotion-judge-1",
          sessionKey: "agent:main:main",
          sessionFile: "/tmp/crawclaw-promotion-judge-session.jsonl",
          workspaceDir: "/tmp/crawclaw-promotion-judge",
          agentId: "main",
          provider: "openai",
          model: "gpt-5.4",
        },
      },
      {
        spawnAgentSessionDirect: vi.fn(),
        captureSubagentCompletionReply: vi.fn(),
        callGateway: vi.fn(),
        onAgentEvent: vi.fn(),
        runEmbeddedPiAgent,
      },
    );

    const params = runEmbeddedPiAgent.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(params?.toolsAllow).toEqual(["submit_promotion_verdict"]);
    expect(params?.streamParams).toEqual(
      expect.objectContaining({
        cacheRetention: "short",
        skipCacheWrite: true,
        toolChoice: {
          type: "tool",
          name: "submit_promotion_verdict",
        },
      }),
    );
  });

  it("does not attach a parent prompt envelope for durable memory special agents", async () => {
    const runEmbeddedPiAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "STATUS: NO_CHANGE" }],
      meta: { durationMs: 1, agentMeta: { usage: { input: 1, output: 1, total: 2 } } },
    });

    await runSpecialAgentToCompletion(
      {
        definition: DURABLE_MEMORY_AGENT_DEFINITION,
        task: "extract memory",
        embeddedContext: {
          sessionId: "session-memory-1",
          sessionKey: "agent:main:main",
          sessionFile: "/tmp/crawclaw-memory-session.jsonl",
          workspaceDir: "/tmp/crawclaw-memory",
          agentId: "main",
          provider: "openai",
          model: "gpt-5.4",
        },
      },
      {
        spawnAgentSessionDirect: vi.fn(),
        captureSubagentCompletionReply: vi.fn(),
        callGateway: vi.fn(),
        onAgentEvent: vi.fn(),
        runEmbeddedPiAgent,
      },
    );

    const params = runEmbeddedPiAgent.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(params?.specialParentPromptEnvelope).toBeUndefined();
    expect(params?.toolsAllow).toEqual([
      "memory_manifest_read",
      "memory_note_read",
      "memory_note_write",
      "memory_note_edit",
      "memory_note_delete",
    ]);
    expect(params?.streamParams).toEqual({
      cacheRetention: "short",
      skipCacheWrite: true,
    });
  });

  it("returns spawn_failed when embedded_fork definitions are missing embedded context", async () => {
    const result = await runSpecialAgentToCompletion(
      {
        definition: TEST_EMBEDDED_SPECIAL_AGENT_DEFINITION,
        task: "do the embedded thing",
      },
      {
        spawnAgentSessionDirect: vi.fn(),
        captureSubagentCompletionReply: vi.fn(),
        callGateway: vi.fn(),
        onAgentEvent: vi.fn(),
        runEmbeddedPiAgent: vi.fn(),
      },
    );

    expect(result).toEqual({
      status: "spawn_failed",
      error:
        "embedded_fork special agents require embeddedContext.sessionId, sessionFile, and workspaceDir",
    });
  });
});
