import { describe, expect, it } from "vitest";
import {
  buildDiagnosticTraceId,
  buildDiagnosticTraceRootSpanId,
  normalizeDiagnosticTraceEnvelope,
} from "./diagnostic-trace.js";

describe("diagnostic trace envelope", () => {
  it("uses the run-loop trace id precedence for defaults", () => {
    expect(buildDiagnosticTraceId({ runId: "run-1", sessionKey: "session-key-1" })).toBe(
      "run-loop:run-1",
    );
    expect(buildDiagnosticTraceId({ sessionKey: "session-key-1", sessionId: "session-1" })).toBe(
      "run-loop:session-key-1",
    );
    expect(buildDiagnosticTraceId({ sessionId: "session-1" })).toBe("run-loop:session-1");
  });

  it("preserves explicit trace fields and derives the parent root span", () => {
    const trace = normalizeDiagnosticTraceEnvelope({
      traceId: "trace-1",
      spanId: "span-1",
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "session-key-1",
      agentId: "agent-1",
      phase: "provider_request_start",
      decisionCode: "provider_request",
    });

    expect(trace).toEqual({
      traceId: "trace-1",
      spanId: "span-1",
      parentSpanId: buildDiagnosticTraceRootSpanId("trace-1"),
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "session-key-1",
      agentId: "agent-1",
      phase: "provider_request_start",
      decisionCode: "provider_request",
    });
  });

  it("keeps an explicit null parent span for root envelopes", () => {
    expect(
      normalizeDiagnosticTraceEnvelope({
        traceId: "trace-1",
        spanId: "root:trace-1",
        parentSpanId: null,
      }),
    ).toEqual({
      traceId: "trace-1",
      spanId: "root:trace-1",
      parentSpanId: null,
    });
  });
});
