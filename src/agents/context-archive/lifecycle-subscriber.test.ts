import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitRunLoopLifecycleEvent,
  resetRunLoopLifecycleHandlersForTests,
} from "../runtime/lifecycle/bus.js";
import {
  __testing,
  getSharedRunLoopContextArchiveLifecycleSubscriber,
} from "./lifecycle-subscriber.js";

const mocks = vi.hoisted(() => ({
  captureContextArchiveRunEvent: vi.fn(),
  updateContextArchiveRunState: vi.fn(),
}));

vi.mock("./run-capture.js", () => ({
  captureContextArchiveRunEvent: mocks.captureContextArchiveRunEvent,
  updateContextArchiveRunState: mocks.updateContextArchiveRunState,
}));

describe("run-loop Context Archive lifecycle subscriber", () => {
  beforeEach(() => {
    resetRunLoopLifecycleHandlersForTests();
    __testing.resetSharedRunLoopContextArchiveLifecycleSubscriber();
    mocks.captureContextArchiveRunEvent.mockReset();
    mocks.captureContextArchiveRunEvent.mockResolvedValue(undefined);
    mocks.updateContextArchiveRunState.mockReset();
    mocks.updateContextArchiveRunState.mockResolvedValue(undefined);
    getSharedRunLoopContextArchiveLifecycleSubscriber();
  });

  it("captures lifecycle phases as archive run events", async () => {
    await emitRunLoopLifecycleEvent({
      phase: "post_sampling",
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "main",
      agentId: "main",
      isTopLevel: true,
      turnIndex: 4,
      messageCount: 4,
    });

    expect(mocks.captureContextArchiveRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "run-loop-lifecycle",
        runId: "run-1",
        sessionId: "session-1",
        sessionKey: "main",
        agentId: "main",
        type: "run.lifecycle.post_sampling",
        turnIndex: 4,
        payload: expect.objectContaining({
          observation: expect.objectContaining({
            trace: {
              traceId: "run-loop:run-1",
              spanId: "root:run-loop:run-1",
              parentSpanId: null,
            },
          }),
          isTopLevel: true,
          metrics: {
            turnIndex: 4,
            messageCount: 4,
          },
          refs: {
            runId: "run-1",
            sessionKey: "main",
            isTopLevel: true,
          },
        }),
        metadata: expect.objectContaining({
          observation: expect.objectContaining({
            trace: expect.objectContaining({
              traceId: "run-loop:run-1",
            }),
          }),
          phase: "post_sampling",
        }),
      }),
    );
    expect(mocks.updateContextArchiveRunState).not.toHaveBeenCalled();
  });

  it("marks archive runs failed on stop_failure", async () => {
    await emitRunLoopLifecycleEvent({
      phase: "stop_failure",
      runId: "run-2",
      sessionId: "session-2",
      sessionKey: "main",
      agentId: "main",
      isTopLevel: true,
      stopReason: "prompt_error",
      error: "prompt_error",
    });

    expect(mocks.captureContextArchiveRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "run.lifecycle.stop_failure",
        payload: expect.objectContaining({
          decision: {
            code: "prompt_error",
          },
        }),
        metadata: expect.objectContaining({
          decisionCode: "prompt_error",
        }),
      }),
    );
    expect(mocks.updateContextArchiveRunState).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "run-loop-lifecycle",
        runId: "run-2",
        sessionId: "session-2",
        status: "failed",
        summary: {
          phase: "stop_failure",
          stopReason: "prompt_error",
          error: "prompt_error",
        },
      }),
    );
  });
});
