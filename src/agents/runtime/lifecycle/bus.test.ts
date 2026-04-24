import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  onDiagnosticEvent,
  resetDiagnosticEventsForTest,
} from "../../../infra/diagnostic-events.js";
import {
  emitRunLoopLifecycleEvent,
  registerRunLoopLifecycleHandler,
  resetRunLoopLifecycleHandlersForTests,
  unregisterRunLoopLifecycleHandler,
} from "./bus.js";
import {
  getSharedRunLoopDiagnosticLifecycleSubscriber,
  __testing as diagnosticLifecycleTesting,
} from "./diagnostic-subscriber.js";

describe("run-loop lifecycle bus", () => {
  beforeEach(() => {
    resetRunLoopLifecycleHandlersForTests();
    resetDiagnosticEventsForTest();
    diagnosticLifecycleTesting.resetRunLoopDiagnosticLifecycleSubscriber();
  });

  it("delivers events to wildcard and phase subscribers", async () => {
    const wildcard = vi.fn();
    const phaseOnly = vi.fn();
    registerRunLoopLifecycleHandler("*", wildcard);
    registerRunLoopLifecycleHandler("post_sampling", phaseOnly);

    await emitRunLoopLifecycleEvent({
      phase: "post_sampling",
      sessionId: "session-1",
      isTopLevel: true,
    });

    expect(wildcard).toHaveBeenCalledTimes(1);
    expect(phaseOnly).toHaveBeenCalledTimes(1);
    const delivered = wildcard.mock.calls[0]?.[0];
    expect(delivered).toEqual(
      expect.objectContaining({
        phase: "post_sampling",
        sessionId: "session-1",
        isTopLevel: true,
        traceId: "run-loop:session-1",
        decision: null,
        metrics: {},
        refs: {
          isTopLevel: true,
        },
      }),
    );
    expect(delivered.spanId).toMatch(/^span:post_sampling:/);
    expect(delivered.parentSpanId).toBe("root:run-loop:session-1");
  });

  it("allows handlers to be unregistered", async () => {
    const handler = vi.fn();
    registerRunLoopLifecycleHandler("settled_turn", handler);
    unregisterRunLoopLifecycleHandler("settled_turn", handler);

    await emitRunLoopLifecycleEvent({
      phase: "settled_turn",
      sessionId: "session-1",
      isTopLevel: true,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("preserves explicit trace envelope fields when provided", async () => {
    const handler = vi.fn();
    registerRunLoopLifecycleHandler("stop", handler);

    await emitRunLoopLifecycleEvent({
      phase: "stop",
      traceId: "trace-1",
      spanId: "span-1",
      parentSpanId: "parent-1",
      sessionId: "session-1",
      isTopLevel: false,
      decision: {
        code: "completed",
        summary: "turn completed without retry",
      },
      metrics: { toolCalls: 2 },
      refs: { provider: "openai" },
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        spanId: "span-1",
        parentSpanId: "parent-1",
        decision: {
          code: "completed",
          summary: "turn completed without retry",
        },
        metrics: { toolCalls: 2 },
        refs: {
          provider: "openai",
          isTopLevel: false,
        },
      }),
    );
  });

  it("bridges lifecycle events to diagnostic run.lifecycle events", async () => {
    const seen: unknown[] = [];
    onDiagnosticEvent((event) => {
      seen.push(event);
    });
    getSharedRunLoopDiagnosticLifecycleSubscriber();
    getSharedRunLoopDiagnosticLifecycleSubscriber();

    await emitRunLoopLifecycleEvent({
      phase: "provider_request_start",
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "session-key-1",
      agentId: "agent-1",
      isTopLevel: true,
      decision: {
        code: "provider_request",
        summary: "provider request started",
      },
      metrics: { durationMs: 7 },
      refs: { provider: "openai" },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(
      expect.objectContaining({
        type: "run.lifecycle",
        phase: "provider_request_start",
        runId: "run-1",
        sessionId: "session-1",
        sessionKey: "session-key-1",
        agentId: "agent-1",
        isTopLevel: true,
        decision: {
          code: "provider_request",
          summary: "provider request started",
        },
        metrics: { durationMs: 7 },
        refs: expect.objectContaining({
          provider: "openai",
          isTopLevel: true,
        }),
        trace: expect.objectContaining({
          traceId: "run-loop:run-1",
          runId: "run-1",
          sessionId: "session-1",
          sessionKey: "session-key-1",
          agentId: "agent-1",
          phase: "provider_request_start",
          decisionCode: "provider_request",
        }),
      }),
    );
    expect((seen[0] as { trace?: { spanId?: string } }).trace?.spanId).toMatch(
      /^span:provider_request_start:/,
    );
    expect((seen[0] as { trace?: { parentSpanId?: string } }).trace?.parentSpanId).toBe(
      "root:run-loop:run-1",
    );
  });
});
