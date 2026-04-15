import { describe, expect, it } from "vitest";
import { getBuiltinHarnessScenarios, runHarnessScenario } from "./scenario-runner.js";

describe("scenario-runner", () => {
  it("exposes deterministic built-in scenarios", () => {
    const scenarios = getBuiltinHarnessScenarios();
    expect(scenarios.map((entry) => entry.name)).toEqual([
      "fix-complete",
      "fix-missing-verification",
      "repeat-no-progress-warning",
    ]);
  });

  it("runs the built-in completion and loop scenarios", () => {
    const scenarios = getBuiltinHarnessScenarios();
    const complete = runHarnessScenario({
      scenario: scenarios[0],
    });
    const incomplete = runHarnessScenario({
      scenario: scenarios[1],
    });
    const warning = runHarnessScenario({
      scenario: scenarios[2],
    });

    expect(complete.completion).toMatchObject({
      status: "accepted",
    });
    expect(incomplete.completion).toMatchObject({
      status: "incomplete",
    });
    expect(warning.loopEvents).toHaveLength(1);
    expect(warning.loopEvents[0]?.result).toMatchObject({
      stuck: true,
      detector: "generic_repeat",
    });
    expect(warning.loopEvents[0]).toMatchObject({
      action: "warn",
      blocked: false,
    });
  });
});
