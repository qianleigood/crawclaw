import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUBAGENT_ENDED_REASON_COMPLETE } from "./subagent-lifecycle-events.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const taskExecutorMocks = vi.hoisted(() => ({
  completeTaskRunByRunId: vi.fn(),
  failTaskRunByRunId: vi.fn(),
  setDetachedTaskDeliveryStatusByRunId: vi.fn(),
}));

const helperMocks = vi.hoisted(() => ({
  persistSubagentSessionTiming: vi.fn(async () => {}),
  safeRemoveAttachmentsDir: vi.fn(async () => {}),
}));

const lifecycleEventMocks = vi.hoisted(() => ({
  emitSessionLifecycleEvent: vi.fn(),
}));

const spineMocks = vi.hoisted(() => ({
  emitRunLoopLifecycleEvent: vi.fn(async () => {}),
}));

const transcriptMocks = vi.hoisted(() => ({
  appendAssistantMessageToSessionTranscript: vi.fn(async () => ({
    ok: true as const,
    sessionFile: "/tmp/acp-wrapper.jsonl",
    messageId: "msg-acp-wrapper",
  })),
}));

vi.mock("../tasks/task-executor.js", () => ({
  completeTaskRunByRunId: taskExecutorMocks.completeTaskRunByRunId,
  failTaskRunByRunId: taskExecutorMocks.failTaskRunByRunId,
  setDetachedTaskDeliveryStatusByRunId: taskExecutorMocks.setDetachedTaskDeliveryStatusByRunId,
}));

vi.mock("../sessions/session-lifecycle-events.js", () => ({
  emitSessionLifecycleEvent: lifecycleEventMocks.emitSessionLifecycleEvent,
}));

vi.mock("../config/sessions/transcript.js", () => ({
  appendAssistantMessageToSessionTranscript:
    transcriptMocks.appendAssistantMessageToSessionTranscript,
}));

vi.mock("./subagent-registry-helpers.js", async () => {
  const actual = await vi.importActual<typeof import("./subagent-registry-helpers.js")>(
    "./subagent-registry-helpers.js",
  );
  return {
    ...actual,
    persistSubagentSessionTiming: helperMocks.persistSubagentSessionTiming,
    safeRemoveAttachmentsDir: helperMocks.safeRemoveAttachmentsDir,
  };
});

vi.mock("./runtime/lifecycle/bus.js", () => ({
  emitRunLoopLifecycleEvent: spineMocks.emitRunLoopLifecycleEvent,
}));

function createRunEntry(overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord {
  return {
    runId: "run-1",
    childSessionKey: "agent:main:subagent:child",
    requesterSessionKey: "agent:main:main",
    requesterDisplayKey: "main",
    task: "finish the task",
    cleanup: "keep",
    createdAt: 1_000,
    startedAt: 2_000,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("subagent registry lifecycle hardening", () => {
  let mod: typeof import("./subagent-registry-lifecycle.js");

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mod = await import("./subagent-registry-lifecycle.js");
  });

  it("does not reject completion when task finalization throws", async () => {
    const persist = vi.fn();
    const warn = vi.fn();
    const entry = createRunEntry();
    const runs = new Map([[entry.runId, entry]]);
    taskExecutorMocks.completeTaskRunByRunId.mockImplementation(() => {
      throw new Error("task store boom");
    });

    const controller = mod.createSubagentRegistryLifecycleController({
      runs,
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      emitSubagentLifecycleEvent: spineMocks.emitRunLoopLifecycleEvent,
      notifyMemoryRuntimeSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => "final completion reply"),
      runSubagentAnnounceFlow: vi.fn(async () => true),
      warn,
    });

    await expect(
      controller.completeSubagentRun({
        runId: entry.runId,
        endedAt: 4_000,
        outcome: { status: "ok" },
        reason: SUBAGENT_ENDED_REASON_COMPLETE,
        triggerCleanup: false,
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "failed to finalize subagent background task state",
      expect.objectContaining({
        decision: "subagent_task_finalize_failed",
        phase: "subagent_stop",
        status: "error",
        runId: "run-1",
        sessionId: "agent:main:subagent:child",
        agentId: "main",
        error: { name: "Error", message: "task store boom" },
        maskedRunId: "***",
        maskedChildSessionKey: "agent:main:…",
        outcomeStatus: "ok",
      }),
    );
    expect(helperMocks.persistSubagentSessionTiming).toHaveBeenCalledTimes(1);
    expect(lifecycleEventMocks.emitSessionLifecycleEvent).toHaveBeenCalledWith({
      sessionKey: "agent:main:subagent:child",
      reason: "subagent-status",
      parentSessionKey: "agent:main:main",
      label: undefined,
    });
    expect(spineMocks.emitRunLoopLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "subagent_stop",
        runId: "run-1",
        entry: expect.objectContaining({
          childSessionKey: "agent:main:subagent:child",
          requesterSessionKey: "agent:main:main",
        }),
        reason: SUBAGENT_ENDED_REASON_COMPLETE,
        outcome: { status: "ok" },
        endedAt: 4_000,
      }),
    );
  });

  it("does not reject cleanup give-up when task delivery status update throws", async () => {
    const persist = vi.fn();
    const warn = vi.fn();
    const entry = createRunEntry({
      endedAt: 4_000,
      expectsCompletionMessage: false,
      retainAttachmentsOnKeep: true,
    });
    taskExecutorMocks.setDetachedTaskDeliveryStatusByRunId.mockImplementation(() => {
      throw new Error("delivery state boom");
    });

    const controller = mod.createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist,
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      emitSubagentLifecycleEvent: spineMocks.emitRunLoopLifecycleEvent,
      notifyMemoryRuntimeSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => undefined),
      runSubagentAnnounceFlow: vi.fn(async () => true),
      warn,
    });

    await expect(
      controller.finalizeResumedAnnounceGiveUp({
        runId: entry.runId,
        entry,
        reason: "retry-limit",
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "failed to update subagent background task delivery state",
      expect.objectContaining({
        decision: "subagent_delivery_status_update_failed",
        phase: "subagent_stop",
        status: "error",
        runId: "run-1",
        sessionId: "agent:main:subagent:child",
        agentId: "main",
        error: { name: "Error", message: "delivery state boom" },
        maskedRunId: "***",
        maskedChildSessionKey: "agent:main:…",
        deliveryStatus: "failed",
      }),
    );
    expect(entry.cleanupCompletedAt).toBeTypeOf("number");
    expect(persist).toHaveBeenCalled();
  });

  it("finalizes tracked ACP runs against the acp task runtime", async () => {
    const entry = createRunEntry({
      runId: "run-acp",
      childSessionKey: "agent:crawclaw:acp:child",
      requesterSessionKey: "agent:main:main",
      taskRuntime: "acp",
    });

    const controller = mod.createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist: vi.fn(),
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      emitSubagentLifecycleEvent: spineMocks.emitRunLoopLifecycleEvent,
      notifyMemoryRuntimeSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => "ACP_LIVE_OK"),
      runSubagentAnnounceFlow: vi.fn(async () => true),
      warn: vi.fn(),
    });

    await controller.completeSubagentRun({
      runId: entry.runId,
      endedAt: 5_000,
      outcome: { status: "ok" },
      reason: SUBAGENT_ENDED_REASON_COMPLETE,
      triggerCleanup: false,
    });

    expect(taskExecutorMocks.completeTaskRunByRunId).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-acp",
        runtime: "acp",
        sessionKey: "agent:crawclaw:acp:child",
      }),
    );
    expect(transcriptMocks.appendAssistantMessageToSessionTranscript).toHaveBeenCalledWith({
      agentId: "crawclaw",
      sessionKey: "agent:crawclaw:acp:child",
      text: "ACP_LIVE_OK",
      idempotencyKey: "acp-wrapper-completion:run-acp",
    });
  });

  it("materializes the ACP wrapper transcript only once across concurrent completion paths", async () => {
    const entry = createRunEntry({
      runId: "run-acp-concurrent",
      childSessionKey: "agent:crawclaw:acp:child",
      requesterSessionKey: "agent:main:main",
      taskRuntime: "acp",
    });
    const gate = createDeferred<{
      ok: true;
      sessionFile: string;
      messageId: string;
    }>();
    transcriptMocks.appendAssistantMessageToSessionTranscript.mockImplementationOnce(
      async () => gate.promise,
    );

    const controller = mod.createSubagentRegistryLifecycleController({
      runs: new Map([[entry.runId, entry]]),
      resumedRuns: new Set(),
      subagentAnnounceTimeoutMs: 1_000,
      persist: vi.fn(),
      clearPendingLifecycleError: vi.fn(),
      countPendingDescendantRuns: () => 0,
      suppressAnnounceForSteerRestart: () => false,
      shouldEmitEndedHookForRun: () => false,
      emitSubagentEndedHookForRun: vi.fn(async () => {}),
      emitSubagentLifecycleEvent: spineMocks.emitRunLoopLifecycleEvent,
      notifyMemoryRuntimeSubagentEnded: vi.fn(async () => {}),
      resumeSubagentRun: vi.fn(),
      captureSubagentCompletionReply: vi.fn(async () => "ACP_LIVE_OK"),
      runSubagentAnnounceFlow: vi.fn(async () => true),
      warn: vi.fn(),
    });

    const completionParams = {
      runId: entry.runId,
      endedAt: 5_000,
      outcome: { status: "ok" } as const,
      reason: SUBAGENT_ENDED_REASON_COMPLETE,
      triggerCleanup: false,
    };

    const first = controller.completeSubagentRun(completionParams);
    const second = controller.completeSubagentRun(completionParams);
    await vi.waitFor(() => {
      expect(transcriptMocks.appendAssistantMessageToSessionTranscript).toHaveBeenCalledTimes(1);
    });

    gate.resolve({
      ok: true,
      sessionFile: "/tmp/acp-wrapper.jsonl",
      messageId: "msg-acp-wrapper",
    });

    await Promise.all([first, second]);

    expect(transcriptMocks.appendAssistantMessageToSessionTranscript).toHaveBeenCalledTimes(1);
    expect(entry.wrapperTranscriptMirroredAt).toBeTypeOf("number");
    expect(entry.wrapperTranscriptMirroring).toBeUndefined();
  });
});
