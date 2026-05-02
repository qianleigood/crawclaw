import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  makeAttemptResult,
  makeCompactionSuccess,
  makeOverflowError,
  mockOverflowRetrySuccess,
  queueOverflowAttemptWithOversizedToolOutput,
} from "./run.overflow-compaction.fixture.js";
import {
  loadRunOverflowCompactionHarness,
  mockedCoerceToFailoverError,
  mockedCompactDirect,
  mockedMemoryRuntime,
  mockedDescribeFailoverError,
  mockedEmitRunLoopLifecycleEvent,
  mockedEnsureSharedRunLoopLifecycleSubscribers,
  mockedEvaluateContextWindowGuard,
  mockedGlobalHookRunner,
  mockedPickFallbackThinkingLevel,
  mockedResolveContextWindowInfo,
  mockedResolveFailoverStatus,
  mockedResolveMemoryRuntime,
  mockedRunMemoryRuntimeMaintenance,
  mockedRunEmbeddedAttempt,
  mockedSessionLikelyHasOversizedToolResults,
  mockedTruncateOversizedToolResultsInSession,
  overflowBaseRunParams,
  resetRunOverflowCompactionHarnessMocks,
} from "./run.overflow-compaction.harness.js";

let runEmbeddedPiAgent: typeof import("./run.js").runEmbeddedPiAgent;

describe("runEmbeddedPiAgent overflow compaction trigger routing", () => {
  beforeAll(async () => {
    ({ runEmbeddedPiAgent } = await loadRunOverflowCompactionHarness());
  });

  beforeEach(() => {
    resetRunOverflowCompactionHarnessMocks();
  });

  it("passes resolved auth profile into run attempts for memory-runtime afterTurn propagation", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(makeAttemptResult({ promptError: null }));

    await runEmbeddedPiAgent({
      ...overflowBaseRunParams,
      runId: "run-auth-profile-passthrough",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        authProfileId: "test-profile",
        authProfileIdSource: "auto",
      }),
    );
  });

  it("skips the main memory runtime for isolated special-agent runs", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(makeAttemptResult({ promptError: null }));

    await runEmbeddedPiAgent({
      ...overflowBaseRunParams,
      runId: "run-isolated-special-memory-runtime",
      specialAgentSpawnSource: "dream",
      specialSystemPromptMode: "isolated",
    });

    expect(mockedResolveMemoryRuntime).not.toHaveBeenCalled();
    const attemptParams = mockedRunEmbeddedAttempt.mock.calls[0]?.[0] as
      | { memoryRuntime?: unknown; specialSystemPromptMode?: string }
      | undefined;
    expect(attemptParams?.specialSystemPromptMode).toBe("isolated");
    expect(attemptParams?.memoryRuntime).toBeUndefined();
  });

  it("emits turn_started before dispatching an embedded attempt", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(makeAttemptResult({ promptError: null }));

    await runEmbeddedPiAgent({
      ...overflowBaseRunParams,
      runId: "run-turn-started",
      trigger: "user",
    });

    expect(mockedEnsureSharedRunLoopLifecycleSubscribers).toHaveBeenCalled();
    expect(mockedEmitRunLoopLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "turn_started",
        runId: "run-turn-started",
        sessionId: "test-session",
        sessionKey: "test-key",
        isTopLevel: true,
        sessionFile: "/tmp/session.json",
        turnIndex: 1,
        metadata: expect.objectContaining({
          trigger: "user",
          workspaceDir: "/tmp/workspace",
        }),
      }),
    );
  });

  it("blocks undersized models before dispatching a provider attempt", async () => {
    mockedResolveContextWindowInfo.mockReturnValue({
      tokens: 800,
      source: "model",
    });
    mockedEvaluateContextWindowGuard.mockReturnValue({
      shouldWarn: true,
      shouldBlock: true,
      tokens: 800,
      source: "model",
    });

    await expect(
      runEmbeddedPiAgent({
        ...overflowBaseRunParams,
        runId: "run-small-context",
      }),
    ).rejects.toThrow("Model context window too small (800 tokens). Minimum is 1000.");

    expect(mockedRunEmbeddedAttempt).not.toHaveBeenCalled();
  });

  it("passes trigger=overflow when retrying compaction after context overflow", async () => {
    mockOverflowRetrySuccess({
      runEmbeddedAttempt: mockedRunEmbeddedAttempt,
      compactDirect: mockedCompactDirect,
    });

    await runEmbeddedPiAgent(overflowBaseRunParams);

    expect(mockedCompactDirect).toHaveBeenCalledTimes(1);
    expect(mockedCompactDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "test-session",
        sessionFile: "/tmp/session.json",
        runtimeContext: expect.objectContaining({
          trigger: "overflow",
          authProfileId: "test-profile",
        }),
      }),
    );
  });

  it("passes observed overflow token counts into compaction when providers report them", async () => {
    const overflowError = new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 277403 tokens > 200000 maximum"}}',
    );

    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(makeAttemptResult({ promptError: overflowError }))
      .mockResolvedValueOnce(makeAttemptResult({ promptError: null }));
    mockedCompactDirect.mockResolvedValueOnce(
      makeCompactionSuccess({
        summary: "Compacted session",
        firstKeptEntryId: "entry-8",
        tokensBefore: 277403,
      }),
    );

    const result = await runEmbeddedPiAgent(overflowBaseRunParams);

    expect(mockedCompactDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTokenCount: 277403,
      }),
    );
    expect(result.meta.error).toBeUndefined();
  });

  it("does not reset compaction attempt budget after successful tool-result truncation", async () => {
    const overflowError = queueOverflowAttemptWithOversizedToolOutput(
      mockedRunEmbeddedAttempt,
      makeOverflowError(),
    );
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(makeAttemptResult({ promptError: overflowError }))
      .mockResolvedValueOnce(makeAttemptResult({ promptError: overflowError }))
      .mockResolvedValueOnce(makeAttemptResult({ promptError: overflowError }));

    mockedCompactDirect
      .mockResolvedValueOnce({
        ok: false,
        compacted: false,
        reason: "nothing to compact",
      })
      .mockResolvedValueOnce(
        makeCompactionSuccess({
          summary: "Compacted 2",
          firstKeptEntryId: "entry-5",
          tokensBefore: 160000,
        }),
      )
      .mockResolvedValueOnce(
        makeCompactionSuccess({
          summary: "Compacted 3",
          firstKeptEntryId: "entry-7",
          tokensBefore: 140000,
        }),
      );

    mockedSessionLikelyHasOversizedToolResults.mockReturnValue(true);
    mockedTruncateOversizedToolResultsInSession.mockResolvedValueOnce({
      truncated: true,
      truncatedCount: 1,
    });

    const result = await runEmbeddedPiAgent(overflowBaseRunParams);

    expect(mockedCompactDirect).toHaveBeenCalledTimes(3);
    expect(mockedTruncateOversizedToolResultsInSession).toHaveBeenCalledTimes(1);
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(4);
    expect(result.meta.error?.kind).toBe("context_overflow");
  });

  it("fires compaction compatibility events during overflow recovery for ownsCompaction engines", async () => {
    mockedMemoryRuntime.info.ownsCompaction = true;
    mockedGlobalHookRunner.hasHooks.mockImplementation(
      (hookName) => hookName === "before_compaction" || hookName === "after_compaction",
    );
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(makeAttemptResult({ promptError: makeOverflowError() }))
      .mockResolvedValueOnce(makeAttemptResult({ promptError: null }));
    mockedCompactDirect.mockResolvedValueOnce({
      ok: true,
      compacted: true,
      result: {
        summary: "engine-owned compaction",
        tokensAfter: 50,
      },
    });

    await runEmbeddedPiAgent(overflowBaseRunParams);

    expect(mockedEnsureSharedRunLoopLifecycleSubscribers).toHaveBeenCalled();
    const emittedPhases = mockedEmitRunLoopLifecycleEvent.mock.calls
      .map((call) => (call as Array<{ phase?: string } | undefined>)[0]?.phase)
      .filter((phase): phase is string => Boolean(phase));
    expect(emittedPhases).toEqual(["turn_started", "pre_compact", "post_compact", "turn_started"]);
    expect(mockedEmitRunLoopLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "pre_compact",
        runId: "run-1",
        sessionId: "test-session",
      }),
    );
    expect(mockedEmitRunLoopLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "post_compact",
        runId: "run-1",
        sessionId: "test-session",
        tokenCount: 50,
      }),
    );
  });

  it("runs maintenance after successful overflow-recovery compaction", async () => {
    mockedMemoryRuntime.info.ownsCompaction = true;
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(makeAttemptResult({ promptError: makeOverflowError() }))
      .mockResolvedValueOnce(makeAttemptResult({ promptError: null }));
    mockedCompactDirect.mockResolvedValueOnce({
      ok: true,
      compacted: true,
      result: {
        summary: "engine-owned compaction",
        tokensAfter: 50,
      },
    });

    await runEmbeddedPiAgent(overflowBaseRunParams);

    expect(mockedRunMemoryRuntimeMaintenance).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryRuntime: mockedMemoryRuntime,
        sessionId: "test-session",
        sessionKey: "test-key",
        sessionFile: "/tmp/session.json",
        reason: "compaction",
        runtimeContext: expect.objectContaining({
          trigger: "overflow",
          authProfileId: "test-profile",
        }),
      }),
    );
  });

  it("guards thrown engine-owned overflow compaction attempts", async () => {
    mockedMemoryRuntime.info.ownsCompaction = true;
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({ promptError: makeOverflowError() }),
    );
    mockedCompactDirect.mockRejectedValueOnce(new Error("engine boom"));

    const result = await runEmbeddedPiAgent(overflowBaseRunParams);

    expect(mockedCompactDirect).toHaveBeenCalledTimes(1);
    expect(mockedEmitRunLoopLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "pre_compact",
        runId: "run-1",
        sessionId: "test-session",
      }),
    );
    expect(mockedEmitRunLoopLifecycleEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "post_compact",
        runId: "run-1",
        sessionId: "test-session",
      }),
    );
    expect(result.meta.error?.kind).toBe("context_overflow");
    expect(result.payloads?.[0]?.isError).toBe(true);
  });

  it("returns retry_limit when repeated retries never converge", async () => {
    mockedRunEmbeddedAttempt.mockClear();
    mockedCompactDirect.mockClear();
    mockedPickFallbackThinkingLevel.mockReset();
    mockedPickFallbackThinkingLevel.mockReturnValue(null);
    mockedRunEmbeddedAttempt.mockResolvedValue(
      makeAttemptResult({
        promptError: new Error("unsupported reasoning mode"),
      }),
    );
    mockedPickFallbackThinkingLevel.mockReturnValue("low");

    const result = await runEmbeddedPiAgent(overflowBaseRunParams);

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(32);
    expect(mockedCompactDirect).not.toHaveBeenCalled();
    expect(result.meta.error?.kind).toBe("retry_limit");
    expect(result.payloads?.[0]?.isError).toBe(true);
  });

  it("normalizes abort-wrapped prompt errors before handing off to model fallback", async () => {
    const promptError = Object.assign(new Error("request aborted"), {
      name: "AbortError",
      cause: {
        error: {
          code: 429,
          message: "Resource has been exhausted (e.g. check quota).",
          status: "RESOURCE_EXHAUSTED",
        },
      },
    });
    const normalized = Object.assign(new Error("Resource has been exhausted (e.g. check quota)."), {
      name: "FailoverError",
      reason: "rate_limit",
      status: 429,
    });

    mockedRunEmbeddedAttempt.mockResolvedValue(makeAttemptResult({ promptError }));
    mockedCoerceToFailoverError.mockReturnValue(normalized);
    mockedDescribeFailoverError.mockImplementation((err: unknown) => ({
      message: err instanceof Error ? err.message : String(err),
      reason: err === normalized ? "rate_limit" : undefined,
      status: err === normalized ? 429 : undefined,
      code: undefined,
    }));
    mockedResolveFailoverStatus.mockReturnValue(429);

    await expect(
      runEmbeddedPiAgent({
        ...overflowBaseRunParams,
        config: {
          agents: {
            defaults: {
              model: {
                fallbacks: ["openai/gpt-5.2"],
              },
            },
          },
        },
      }),
    ).rejects.toBe(normalized);

    expect(mockedCoerceToFailoverError).toHaveBeenCalledWith(
      promptError,
      expect.objectContaining({
        provider: "anthropic",
        model: "test-model",
        profileId: "test-profile",
      }),
    );
    expect(mockedResolveFailoverStatus).toHaveBeenCalledWith("rate_limit");
  });
});
