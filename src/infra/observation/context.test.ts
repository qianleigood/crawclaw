import { describe, expect, it } from "vitest";
import {
  createObservationRoot,
  deriveObservationChild,
  normalizeObservationContext,
} from "./context.js";

describe("ObservationContext", () => {
  it("creates a root observation from run-loop identity defaults", () => {
    const observation = createObservationRoot({
      source: "run-loop",
      runtime: {
        runId: "run-1",
        sessionId: "session-1",
        sessionKey: "session-key-1",
        agentId: "agent-1",
      },
      phase: "turn_started",
      decisionCode: "turn_started",
    });

    expect(observation).toEqual({
      trace: {
        traceId: "run-loop:run-1",
        spanId: "root:run-loop:run-1",
        parentSpanId: null,
      },
      runtime: {
        runId: "run-1",
        sessionId: "session-1",
        sessionKey: "session-key-1",
        agentId: "agent-1",
      },
      phase: "turn_started",
      decisionCode: "turn_started",
      source: "run-loop",
    });
  });

  it("derives child observations while preserving the trace identity", () => {
    const root = createObservationRoot({
      source: "run-loop",
      runtime: { runId: "run-1", sessionId: "session-1" },
      phase: "turn_started",
    });

    const child = deriveObservationChild(root, {
      source: "provider",
      spanId: "provider:req-1",
      phase: "provider_request_start",
      decisionCode: "provider_request",
      refs: { requestId: "req-1" },
    });

    expect(child).toEqual({
      trace: {
        traceId: "run-loop:run-1",
        spanId: "provider:req-1",
        parentSpanId: "root:run-loop:run-1",
      },
      runtime: {
        runId: "run-1",
        sessionId: "session-1",
      },
      phase: "provider_request_start",
      decisionCode: "provider_request",
      source: "provider",
      refs: { requestId: "req-1" },
    });
  });

  it("normalizes explicit traceparent values into observation trace fields", () => {
    const observation = normalizeObservationContext({
      source: "gateway",
      trace: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
      runtime: {
        sessionId: "session-1",
      },
    });

    expect(observation.trace).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "root:4bf92f3577b34da6a3ce929d0e0e4736",
      parentSpanId: "00f067aa0ba902b7",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
  });
});
