import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagingToolSend } from "./pi-embedded-messaging.js";
import type {
  ToolCallSummary,
  ToolHandlerContext,
} from "./pi-embedded-subscribe.handlers.types.js";

const lifecycleMocks = vi.hoisted(() => ({
  emitRunLoopLifecycleEvent: vi.fn(async () => {}),
}));

vi.mock("./runtime/lifecycle/bus.js", () => ({
  emitRunLoopLifecycleEvent: lifecycleMocks.emitRunLoopLifecycleEvent,
}));

import {
  handleToolExecutionEnd,
  handleToolExecutionStart,
} from "./pi-embedded-subscribe.handlers.tools.js";

type ToolExecutionStartEvent = Extract<AgentEvent, { type: "tool_execution_start" }>;
type ToolExecutionEndEvent = Extract<AgentEvent, { type: "tool_execution_end" }>;

function createTestContext(): ToolHandlerContext {
  return {
    params: {
      runId: "run-test",
      sessionId: "session-test",
      sessionKey: "agent:main:discord:user-1",
      agentId: "main",
      onBlockReplyFlush: vi.fn(),
      onAgentEvent: undefined,
      onToolResult: undefined,
    },
    flushBlockReplyBuffer: vi.fn(),
    hookRunner: undefined,
    log: {
      debug: vi.fn(),
      warn: vi.fn(),
    },
    state: {
      toolMetaById: new Map<string, ToolCallSummary>(),
      toolMetas: [],
      toolSummaryById: new Set<string>(),
      pendingMessagingTargets: new Map<string, MessagingToolSend>(),
      pendingMessagingTexts: new Map<string, string>(),
      pendingMessagingMediaUrls: new Map<string, string[]>(),
      pendingToolMediaUrls: [],
      pendingToolAudioAsVoice: false,
      messagingToolSentTexts: [],
      messagingToolSentTextsNormalized: [],
      messagingToolSentMediaUrls: [],
      messagingToolSentTargets: [],
      successfulCronAdds: 0,
      deterministicApprovalPromptSent: false,
    },
    shouldEmitToolResult: () => false,
    shouldEmitToolOutput: () => false,
    emitToolSummary: vi.fn(),
    emitToolOutput: vi.fn(),
    trimMessagingToolSent: vi.fn(),
  };
}

describe("tool lifecycle events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits start and stop events with a stable tool span", async () => {
    const ctx = createTestContext();
    const startEvt: ToolExecutionStartEvent = {
      type: "tool_execution_start",
      toolName: "read",
      toolCallId: "tool-1",
      args: { path: "/tmp/a.txt" },
    };
    const endEvt: ToolExecutionEndEvent = {
      type: "tool_execution_end",
      toolName: "read",
      toolCallId: "tool-1",
      isError: false,
      result: { details: { status: "ok" } },
    };

    await handleToolExecutionStart(ctx, startEvt);
    vi.advanceTimersByTime(250);
    await handleToolExecutionEnd(ctx, endEvt);

    expect(lifecycleMocks.emitRunLoopLifecycleEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        phase: "tool_call_start",
        runId: "run-test",
        sessionId: "session-test",
        decision: expect.objectContaining({ code: "tool_call_started" }),
        refs: expect.objectContaining({
          toolName: "read",
          toolCallId: "tool-1",
        }),
      }),
    );
    expect(lifecycleMocks.emitRunLoopLifecycleEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        phase: "tool_call_stop",
        decision: expect.objectContaining({ code: "tool_call_succeeded" }),
        metrics: expect.objectContaining({ durationMs: 250 }),
      }),
    );
    const emittedCalls = lifecycleMocks.emitRunLoopLifecycleEvent.mock.calls as unknown as Array<
      [{ spanId?: string }]
    >;
    const startEvent = emittedCalls[0]?.[0];
    const stopEvent = emittedCalls[1]?.[0];
    expect(startEvent?.spanId).toBe(stopEvent?.spanId);
  });

  it("emits tool_call_error with timeout decision when the tool times out", async () => {
    const ctx = createTestContext();
    const endEvt: ToolExecutionEndEvent = {
      type: "tool_execution_end",
      toolName: "bash",
      toolCallId: "tool-timeout",
      isError: true,
      result: {
        details: {
          timedOut: true,
        },
        error: "timed out",
      },
    };

    await handleToolExecutionEnd(ctx, endEvt);

    expect(lifecycleMocks.emitRunLoopLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "tool_call_error",
        error: "timed out",
        decision: expect.objectContaining({ code: "tool_call_timed_out" }),
      }),
    );
  });
});
