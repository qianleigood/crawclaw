import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitDiagnosticEvent,
  isDiagnosticsEnabled,
  onDiagnosticEvent,
  resetDiagnosticEventsForTest,
} from "./diagnostic-events.js";
import { createObservationRoot } from "./observation/context.js";

function testObservation() {
  return createObservationRoot({
    source: "test",
    runtime: {
      sessionId: "session-1",
    },
  });
}

describe("diagnostic-events", () => {
  beforeEach(() => {
    resetDiagnosticEventsForTest();
  });

  afterEach(() => {
    resetDiagnosticEventsForTest();
    vi.restoreAllMocks();
  });

  it("emits monotonic seq and timestamps to subscribers", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(111).mockReturnValueOnce(222);
    const events: Array<{ seq: number; ts: number; type: string }> = [];
    const stop = onDiagnosticEvent((event) => {
      events.push({ seq: event.seq, ts: event.ts, type: event.type });
    });

    emitDiagnosticEvent({
      type: "model.usage",
      observation: testObservation(),
      usage: { total: 1 },
    });
    emitDiagnosticEvent({
      type: "session.state",
      observation: testObservation(),
      state: "processing",
    });
    stop();

    expect(events).toEqual([
      { seq: 1, ts: 111, type: "model.usage" },
      { seq: 2, ts: 222, type: "session.state" },
    ]);
  });

  it("isolates listener failures and logs them", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    onDiagnosticEvent(() => {
      throw new Error("boom");
    });
    onDiagnosticEvent((event) => {
      seen.push(event.type);
    });

    emitDiagnosticEvent({
      type: "message.queued",
      observation: testObservation(),
      source: "telegram",
    });

    expect(seen).toEqual(["message.queued"]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("listener error type=message.queued seq=1: Error: boom"),
    );
  });

  it("supports unsubscribe and full reset", () => {
    const seen: string[] = [];
    const stop = onDiagnosticEvent((event) => {
      seen.push(event.type);
    });

    emitDiagnosticEvent({
      type: "webhook.received",
      observation: testObservation(),
      channel: "telegram",
    });
    stop();
    emitDiagnosticEvent({
      type: "webhook.processed",
      observation: testObservation(),
      channel: "telegram",
    });

    expect(seen).toEqual(["webhook.received"]);

    resetDiagnosticEventsForTest();
    emitDiagnosticEvent({
      type: "webhook.error",
      observation: testObservation(),
      channel: "telegram",
      error: "failed",
    });
    expect(seen).toEqual(["webhook.received"]);
  });

  it("accepts diagnostic events with an observation context", () => {
    const seen: unknown[] = [];
    onDiagnosticEvent((event) => {
      seen.push(event);
    });

    emitDiagnosticEvent({
      type: "message.processed",
      channel: "telegram",
      outcome: "completed",
      observation: createObservationRoot({
        source: "diagnostic",
        runtime: {
          runId: "run-1",
          sessionId: "session-1",
          sessionKey: "session-key-1",
        },
      }),
    });

    expect(seen).toEqual([
      expect.objectContaining({
        type: "message.processed",
        observation: expect.objectContaining({
          trace: {
            traceId: "run-loop:run-1",
            spanId: "root:run-loop:run-1",
            parentSpanId: null,
          },
          runtime: {
            runId: "run-1",
            sessionId: "session-1",
            sessionKey: "session-key-1",
          },
        }),
      }),
    ]);
  });

  it("accepts run lifecycle diagnostic events", () => {
    const seen: unknown[] = [];
    onDiagnosticEvent((event) => {
      seen.push(event);
    });

    emitDiagnosticEvent({
      type: "run.lifecycle",
      phase: "provider_request_start",
      observation: createObservationRoot({
        source: "run-loop",
        runtime: {
          runId: "run-1",
          sessionId: "session-1",
          sessionKey: "session-key-1",
        },
        phase: "provider_request_start",
        decisionCode: "provider_request",
        refs: { provider: "openai" },
      }),
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "session-key-1",
      isTopLevel: true,
      decision: { code: "provider_request" },
      metrics: { durationMs: 7 },
      refs: { provider: "openai" },
    });

    expect(seen).toEqual([
      expect.objectContaining({
        type: "run.lifecycle",
        phase: "provider_request_start",
        decision: { code: "provider_request" },
        metrics: { durationMs: 7 },
        refs: { provider: "openai" },
        observation: expect.objectContaining({
          phase: "provider_request_start",
          decisionCode: "provider_request",
          trace: {
            traceId: "run-loop:run-1",
            spanId: "root:run-loop:run-1",
            parentSpanId: null,
          },
        }),
      }),
    ]);
  });

  it("drops recursive emissions after the guard threshold", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    onDiagnosticEvent(() => {
      calls += 1;
      emitDiagnosticEvent({
        type: "queue.lane.enqueue",
        observation: testObservation(),
        lane: "main",
        queueSize: calls,
      });
    });

    emitDiagnosticEvent({
      type: "queue.lane.enqueue",
      observation: testObservation(),
      lane: "main",
      queueSize: 0,
    });

    expect(calls).toBe(101);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "recursion guard tripped at depth=101, dropping type=queue.lane.enqueue",
      ),
    );
  });

  it("requires an explicit true diagnostics flag", () => {
    expect(isDiagnosticsEnabled()).toBe(false);
    expect(isDiagnosticsEnabled({ diagnostics: { enabled: false } } as never)).toBe(false);
    expect(isDiagnosticsEnabled({ diagnostics: { enabled: true } } as never)).toBe(true);
  });
});
