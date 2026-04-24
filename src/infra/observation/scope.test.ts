import { describe, expect, it } from "vitest";
import { createObservationRoot } from "./context.js";
import { getCurrentObservationContext, withObservationContext } from "./scope.js";

describe("observation scope", () => {
  it("preserves and restores AsyncLocalStorage observation context", async () => {
    const outer = createObservationRoot({
      source: "outer",
      runtime: { runId: "run-outer", sessionId: "session-outer" },
    });
    const inner = createObservationRoot({
      source: "inner",
      runtime: { runId: "run-inner", sessionId: "session-inner" },
    });

    expect(getCurrentObservationContext()).toBeUndefined();
    await withObservationContext(outer, async () => {
      expect(getCurrentObservationContext()).toBe(outer);
      await withObservationContext(inner, async () => {
        expect(getCurrentObservationContext()).toBe(inner);
      });
      expect(getCurrentObservationContext()).toBe(outer);
    });
    expect(getCurrentObservationContext()).toBeUndefined();
  });
});
