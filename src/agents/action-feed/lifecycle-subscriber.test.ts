import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitRunLoopLifecycleEvent,
  resetRunLoopLifecycleHandlersForTests,
} from "../runtime/lifecycle/bus.js";
import {
  __testing,
  getSharedRunLoopActionFeedLifecycleSubscriber,
} from "./lifecycle-subscriber.js";

const mocks = vi.hoisted(() => ({
  emitAgentActionEvent: vi.fn(),
}));

vi.mock("./emit.js", () => ({
  emitAgentActionEvent: mocks.emitAgentActionEvent,
}));

describe("run-loop Action Feed lifecycle subscriber", () => {
  beforeEach(() => {
    resetRunLoopLifecycleHandlersForTests();
    __testing.resetSharedRunLoopActionFeedLifecycleSubscriber();
    mocks.emitAgentActionEvent.mockReset();
    getSharedRunLoopActionFeedLifecycleSubscriber();
  });

  it("emits a running compaction action on pre_compact", async () => {
    await emitRunLoopLifecycleEvent({
      phase: "pre_compact",
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "main",
      agentId: "main",
      isTopLevel: true,
      metadata: { trigger: "manual" },
    });

    expect(mocks.emitAgentActionEvent).toHaveBeenCalledWith({
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "main",
      agentId: "main",
      data: expect.objectContaining({
        actionId: "compaction:run-1",
        kind: "compaction",
        status: "running",
        title: "Compacting context",
      }),
    });
  });

  it("emits a retrying compaction action on post_compact with willRetry", async () => {
    await emitRunLoopLifecycleEvent({
      phase: "post_compact",
      runId: "run-2",
      sessionId: "session-2",
      sessionKey: "main",
      agentId: "main",
      isTopLevel: true,
      metadata: { willRetry: true, completed: true },
    });

    expect(mocks.emitAgentActionEvent).toHaveBeenCalledWith({
      runId: "run-2",
      sessionId: "session-2",
      sessionKey: "main",
      agentId: "main",
      data: expect.objectContaining({
        actionId: "compaction:run-2",
        kind: "compaction",
        status: "running",
        title: "Retrying after compaction",
      }),
    });
  });
});
