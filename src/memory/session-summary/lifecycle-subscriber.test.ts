import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitRunLoopLifecycleEvent,
  resetRunLoopLifecycleHandlersForTests,
} from "../../agents/runtime/lifecycle/bus.js";
import { buildSpecialAgentCacheEnvelope } from "../../agents/special/runtime/parent-fork-context.js";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { SessionSummaryLifecycleSubscriber } from "./lifecycle-subscriber.ts";
import type { SessionSummaryScheduler } from "./scheduler.ts";

describe("SessionSummaryLifecycleSubscriber", () => {
  beforeEach(() => {
    resetRunLoopLifecycleHandlersForTests();
  });

  afterEach(() => {
    resetRunLoopLifecycleHandlersForTests();
  });

  function createRuntimeStore() {
    return {
      getSessionSummaryState: vi.fn().mockResolvedValue(null),
      listMessagesByTurnRange: vi.fn().mockResolvedValue([
        { id: "msg-1", turnIndex: 1, role: "user", content: "start" },
        { id: "msg-2", turnIndex: 2, role: "assistant", content: "done" },
      ]),
    };
  }

  function createParentForkContext() {
    return {
      parentRunId: "run-1",
      provider: "openai",
      modelId: "gpt-5.4",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "parent system",
        forkContextMessages: [
          { role: "user", content: "start" },
          { role: "assistant", content: "done" },
        ],
      }),
    };
  }

  it("passes model-aware summary thresholds from lifecycle metadata into the scheduler", async () => {
    const submitTurn = vi.fn();
    const runtimeStore = createRuntimeStore();
    const subscriber = new SessionSummaryLifecycleSubscriber({
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      scheduler: { submitTurn } as unknown as SessionSummaryScheduler,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    subscriber.ensureRegistered();
    const parentForkContext = createParentForkContext();

    await emitRunLoopLifecycleEvent({
      phase: "settled_turn",
      sessionId: "session-policy-1",
      sessionKey: "agent:main:main",
      agentId: "main",
      isTopLevel: true,
      sessionFile: "/tmp/session-policy-1.jsonl",
      messageCount: 2,
      metadata: {
        prePromptMessageCount: 0,
        parentForkContext,
        contextBudgetPolicy: {
          sessionSummary: {
            lightInitialTokenThreshold: 24_000,
            initialTokenThreshold: 80_000,
            updateTokenThreshold: 40_000,
          },
        },
      },
    });

    await vi.waitFor(() => {
      expect(submitTurn).toHaveBeenCalledTimes(1);
    });
    expect(submitTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        lightInitialTokenThreshold: 24_000,
        initialTokenThreshold: 80_000,
        updateTokenThreshold: 40_000,
      }),
    );
  });

  it("ignores post_sampling events for session summary scheduling", async () => {
    const submitTurn = vi.fn();
    const subscriber = new SessionSummaryLifecycleSubscriber({
      runtimeStore: createRuntimeStore() as unknown as RuntimeStore,
      scheduler: { submitTurn } as unknown as SessionSummaryScheduler,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    subscriber.ensureRegistered();

    await emitRunLoopLifecycleEvent({
      phase: "post_sampling",
      sessionId: "session-policy-1",
      sessionKey: "agent:main:main",
      agentId: "main",
      isTopLevel: true,
      sessionFile: "/tmp/session-policy-1.jsonl",
      messageCount: 2,
      metadata: {
        prePromptMessageCount: 0,
        parentForkContext: createParentForkContext(),
      },
    });

    expect(submitTurn).not.toHaveBeenCalled();
  });
});
