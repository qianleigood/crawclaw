import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  onDiagnosticEvent,
  resetDiagnosticEventsForTest,
} from "../../../infra/diagnostic-events.js";
import {
  createObservationRoot,
  deriveObservationChild,
} from "../../../infra/observation/context.js";
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
        decision: null,
        metrics: {},
        refs: {
          isTopLevel: true,
        },
        observation: expect.objectContaining({
          trace: {
            traceId: "run-loop:session-1",
            spanId: "root:run-loop:session-1",
            parentSpanId: null,
          },
          phase: "post_sampling",
          source: "run-loop",
        }),
      }),
    );
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

  it("derives lifecycle observations from an explicit parent observation", async () => {
    const handler = vi.fn();
    registerRunLoopLifecycleHandler("stop", handler);
    const parent = createObservationRoot({
      source: "run-loop",
      runtime: {
        runId: "run-1",
        sessionId: "session-1",
      },
      phase: "turn_started",
    });
    const child = deriveObservationChild(parent, {
      source: "run-loop",
      phase: "stop",
      decisionCode: "completed",
    });

    await emitRunLoopLifecycleEvent({
      phase: "stop",
      observation: child,
      runId: "run-1",
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
        observation: expect.objectContaining({
          trace: expect.objectContaining({
            traceId: "run-loop:run-1",
            parentSpanId: "root:run-loop:run-1",
          }),
          phase: "stop",
          decisionCode: "completed",
          source: "run-loop",
        }),
        decision: {
          code: "completed",
          summary: "turn completed without retry",
        },
        metrics: { toolCalls: 2 },
        refs: {
          provider: "openai",
          runId: "run-1",
          isTopLevel: false,
        },
      }),
    );
    expect(handler.mock.calls[0]?.[0].observation.trace.spanId).toBe(child.trace.spanId);
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
        observation: expect.objectContaining({
          phase: "provider_request_start",
          decisionCode: "provider_request",
          runtime: {
            runId: "run-1",
            sessionId: "session-1",
            sessionKey: "session-key-1",
            agentId: "agent-1",
          },
          trace: expect.objectContaining({
            traceId: "run-loop:run-1",
            parentSpanId: null,
          }),
        }),
      }),
    );
    expect(
      (seen[0] as { observation?: { trace?: { spanId?: string } } }).observation?.trace?.spanId,
    ).toBe("root:run-loop:run-1");
    expect(
      (seen[0] as { observation?: { trace?: { parentSpanId?: string | null } } }).observation?.trace
        ?.parentSpanId,
    ).toBeNull();
  });

  it("normalizes repeated root lifecycle events for one run to the same root observation", async () => {
    const handler = vi.fn();
    registerRunLoopLifecycleHandler("*", handler);

    await emitRunLoopLifecycleEvent({
      phase: "turn_started",
      runId: "run-single-root",
      sessionId: "session-1",
      isTopLevel: true,
    });
    await emitRunLoopLifecycleEvent({
      phase: "settled_turn",
      runId: "run-single-root",
      sessionId: "session-1",
      isTopLevel: true,
    });

    const observations = handler.mock.calls.map(
      (call) =>
        (
          call[0] as {
            observation: {
              trace: { traceId: string; spanId: string; parentSpanId: string | null };
            };
          }
        ).observation,
    );
    expect(new Set(observations.map((observation) => observation.trace.traceId))).toEqual(
      new Set(["run-loop:run-single-root"]),
    );
    expect(observations.map((observation) => observation.trace.spanId)).toEqual([
      "root:run-loop:run-single-root",
      "root:run-loop:run-single-root",
    ]);
    expect(observations.map((observation) => observation.trace.parentSpanId)).toEqual([null, null]);
  });
});
