import { describe, expect, it } from "vitest";
import { createObservationRoot } from "./context.js";
import { extractObservationPropagation, injectObservationPropagation } from "./propagation.js";

describe("observation propagation", () => {
  it("injects and extracts W3C trace context", () => {
    const observation = createObservationRoot({
      source: "gateway",
      runtime: { runId: "run-1", sessionId: "session-1" },
    });
    const carrier = new Map<string, string>();

    injectObservationPropagation(carrier, observation);

    const traceparent = carrier.get("traceparent");
    expect(traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);

    const extracted = extractObservationPropagation(carrier);
    expect(extracted).toEqual({
      traceparent,
    });
  });
});
