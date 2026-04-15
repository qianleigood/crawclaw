import { describe, expect, it } from "vitest";
import { buildHarnessReport, diffHarnessReports } from "./report.js";
import { getBuiltinHarnessScenarios } from "./scenario-runner.js";

describe("harness report", () => {
  it("builds a summary from builtin scenarios", () => {
    const report = buildHarnessReport({
      scenarios: getBuiltinHarnessScenarios(),
      loopDetectionConfig: { enabled: true },
    });

    expect(report.summary).toMatchObject({
      scenarioCount: 3,
      completionScenarioCount: 2,
      acceptedCount: 1,
      incompleteCount: 1,
      loopSignalCount: 1,
    });
    expect(report.scenarios.map((entry) => entry.name)).toEqual([
      "fix-complete",
      "fix-missing-verification",
      "repeat-no-progress-warning",
    ]);
  });

  it("diffs baseline and candidate reports", () => {
    const scenarios = getBuiltinHarnessScenarios();
    const baseline = buildHarnessReport({
      scenarios,
      loopDetectionConfig: { enabled: true },
    });
    const candidate = buildHarnessReport({
      scenarios,
      loopDetectionConfig: {
        enabled: true,
        warningThreshold: 50,
      },
    });

    const diff = diffHarnessReports({
      baseline,
      candidate,
    });

    expect(diff.delta.blockedScenarioCount).toBe(0);
    expect(diff.delta.acceptedCount).toBe(0);
    expect(diff.changedScenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "repeat-no-progress-warning",
        }),
      ]),
    );
    expect(
      diff.changedScenarios.find((entry) => entry.name === "repeat-no-progress-warning")?.candidate
        .loopEventCount,
    ).toBe(0);
  });
});
