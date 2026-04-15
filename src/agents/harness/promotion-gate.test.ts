import { describe, expect, it } from "vitest";
import { evaluateHarnessPromotion } from "./promotion-gate.js";
import { buildHarnessReport, type HarnessReport } from "./report.js";
import { getBuiltinHarnessScenarios } from "./scenario-runner.js";

function createReportSummary(overrides?: Partial<HarnessReport["summary"]>): HarnessReport {
  return {
    scenarios: [],
    summary: {
      scenarioCount: 3,
      completionScenarioCount: 2,
      acceptedCount: 1,
      waitingCount: 0,
      incompleteCount: 1,
      loopSignalCount: 1,
      blockedScenarioCount: 1,
      blockedEventCount: 1,
      completionMismatchCount: 0,
      avgToolCallsPerScenario: 2,
      ...overrides,
    },
  };
}

describe("harness promotion gate", () => {
  it("returns shadow when a candidate stays within guardrails without improving metrics", () => {
    const scenarios = getBuiltinHarnessScenarios();
    const baseline = buildHarnessReport({
      scenarios,
      loopDetectionConfig: { enabled: true },
    });
    const candidate = buildHarnessReport({
      scenarios,
      loopDetectionConfig: { enabled: true },
    });

    const decision = evaluateHarnessPromotion({
      baseline,
      candidate,
    });

    expect(decision.verdict).toBe("shadow");
    expect(decision.reasons).toEqual([
      "Candidate stays within guardrails but does not materially improve tracked harness metrics.",
    ]);
  });

  it("returns promote when the candidate improves tracked harness metrics", () => {
    const baseline = createReportSummary();
    const candidate = createReportSummary({
      acceptedCount: 2,
      incompleteCount: 0,
      blockedScenarioCount: 0,
      blockedEventCount: 0,
      avgToolCallsPerScenario: 1.5,
    });

    const decision = evaluateHarnessPromotion({
      baseline,
      candidate,
    });

    expect(decision.verdict).toBe("promote");
    expect(decision.diff.delta.blockedEventCount).toBeLessThan(0);
  });

  it("returns reject when the candidate regresses guarded thresholds", () => {
    const baseline = createReportSummary({
      blockedScenarioCount: 0,
      blockedEventCount: 0,
      incompleteCount: 0,
      acceptedCount: 2,
    });
    const candidate = createReportSummary({
      blockedScenarioCount: 1,
      blockedEventCount: 2,
      incompleteCount: 1,
      acceptedCount: 1,
    });

    const decision = evaluateHarnessPromotion({
      baseline,
      candidate,
    });

    expect(decision.verdict).toBe("reject");
    expect(decision.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Blocked loop events increased")]),
    );
  });
});
