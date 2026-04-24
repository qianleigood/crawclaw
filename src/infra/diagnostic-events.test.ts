import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emitDiagnosticEvent,
  isDiagnosticsEnabled,
  onDiagnosticEvent,
  resetDiagnosticEventsForTest,
} from "./diagnostic-events.js";

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
      usage: { total: 1 },
    });
    emitDiagnosticEvent({
      type: "session.state",
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
      channel: "telegram",
    });
    stop();
    emitDiagnosticEvent({
      type: "webhook.processed",
      channel: "telegram",
    });

    expect(seen).toEqual(["webhook.received"]);

    resetDiagnosticEventsForTest();
    emitDiagnosticEvent({
      type: "webhook.error",
      channel: "telegram",
      error: "failed",
    });
    expect(seen).toEqual(["webhook.received"]);
  });

  it("accepts diagnostic events with a trace envelope", () => {
    const seen: unknown[] = [];
    onDiagnosticEvent((event) => {
      seen.push(event);
    });

    emitDiagnosticEvent({
      type: "message.processed",
      channel: "telegram",
      outcome: "completed",
      trace: {
        traceId: "run-loop:run-1",
        spanId: "span-message-1",
        parentSpanId: "root:run-loop:run-1",
        runId: "run-1",
        sessionId: "session-1",
        sessionKey: "session-key-1",
      },
    });

    expect(seen).toEqual([
      expect.objectContaining({
        type: "message.processed",
        trace: {
          traceId: "run-loop:run-1",
          spanId: "span-message-1",
          parentSpanId: "root:run-loop:run-1",
          runId: "run-1",
          sessionId: "session-1",
          sessionKey: "session-key-1",
        },
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
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "session-key-1",
      isTopLevel: true,
      decision: { code: "provider_request" },
      metrics: { durationMs: 7 },
      refs: { provider: "openai" },
      trace: {
        traceId: "run-loop:run-1",
        spanId: "span-provider-1",
        parentSpanId: "root:run-loop:run-1",
        runId: "run-1",
        sessionId: "session-1",
        sessionKey: "session-key-1",
        phase: "provider_request_start",
        decisionCode: "provider_request",
      },
    });

    expect(seen).toEqual([
      expect.objectContaining({
        type: "run.lifecycle",
        phase: "provider_request_start",
        decision: { code: "provider_request" },
        metrics: { durationMs: 7 },
        refs: { provider: "openai" },
        trace: expect.objectContaining({
          traceId: "run-loop:run-1",
          spanId: "span-provider-1",
          phase: "provider_request_start",
          decisionCode: "provider_request",
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
        lane: "main",
        queueSize: calls,
      });
    });

    emitDiagnosticEvent({
      type: "queue.lane.enqueue",
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
