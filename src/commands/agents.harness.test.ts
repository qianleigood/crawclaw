import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildHarnessReport } from "../agents/harness/report.js";
import { getBuiltinHarnessScenarios } from "../agents/harness/scenario-runner.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  agentsHarnessPromoteCheckCommand,
  agentsHarnessReportCommand,
} from "./agents.harness.js";

function createRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
    writeStdout: vi.fn(),
    writeJson: vi.fn(),
  };
}

describe("agents harness commands", () => {
  it("prints builtin harness report in text mode", async () => {
    const runtime = createRuntime();

    await agentsHarnessReportCommand({}, runtime);

    expect(runtime.log).toHaveBeenCalledTimes(1);
    const output = String(runtime.log.mock.calls[0]?.[0] ?? "");
    expect(output).toContain("Harness report:");
    expect(output).toContain("fix-complete");
    expect(output).toContain("repeat-no-progress-warning");
  });

  it("emits builtin harness report as JSON", async () => {
    const runtime = createRuntime();

    await agentsHarnessReportCommand({ json: true }, runtime);

    expect(runtime.writeJson).toHaveBeenCalledTimes(1);
    const [report] = runtime.writeJson.mock.calls[0] ?? [];
    expect(report).toMatchObject({
      summary: expect.objectContaining({
        scenarioCount: 3,
        completionScenarioCount: 2,
      }),
    });
  });

  it("filters builtin harness report scenarios by name", async () => {
    const runtime = createRuntime();

    await agentsHarnessReportCommand({ scenario: ["fix-complete"], json: true }, runtime);

    const [report] = runtime.writeJson.mock.calls[0] ?? [];
    expect(report).toMatchObject({
      scenarios: [expect.objectContaining({ name: "fix-complete" })],
      summary: expect.objectContaining({
        scenarioCount: 1,
      }),
    });
  });

  it("prints a promote-check verdict from report files", async () => {
    await withTempDir({ prefix: "crawclaw-harness-cli-" }, async (dir) => {
      const runtime = createRuntime();
      const scenarios = getBuiltinHarnessScenarios();
      const baseline = buildHarnessReport({
        scenarios,
        loopDetectionConfig: { enabled: true },
      });
      const candidate = buildHarnessReport({
        scenarios,
        loopDetectionConfig: { enabled: true },
      });
      const baselinePath = path.join(dir, "baseline.json");
      const candidatePath = path.join(dir, "candidate.json");
      await fs.writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
      await fs.writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);

      await agentsHarnessPromoteCheckCommand(
        {
          baseline: baselinePath,
          candidate: candidatePath,
        },
        runtime,
      );

      expect(runtime.log).toHaveBeenCalledTimes(1);
      const output = String(runtime.log.mock.calls[0]?.[0] ?? "");
      expect(output).toContain("Harness promote-check:");
      expect(output).toContain("Verdict: shadow");
      expect(output).toContain("Candidate stays within guardrails");
    });
  });

  it("emits promote-check decisions as JSON", async () => {
    await withTempDir({ prefix: "crawclaw-harness-cli-" }, async (dir) => {
      const runtime = createRuntime();
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
      const baselinePath = path.join(dir, "baseline.json");
      const candidatePath = path.join(dir, "candidate.json");
      await fs.writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
      await fs.writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);

      await agentsHarnessPromoteCheckCommand(
        {
          baseline: baselinePath,
          candidate: candidatePath,
          json: true,
        },
        runtime,
      );

      expect(runtime.writeJson).toHaveBeenCalledTimes(1);
      const [decision] = runtime.writeJson.mock.calls[0] ?? [];
      expect(decision).toMatchObject({
        verdict: "shadow",
        diff: expect.objectContaining({
          baseline: expect.objectContaining({
            scenarioCount: 3,
          }),
          candidate: expect.objectContaining({
            scenarioCount: 3,
          }),
        }),
      });
    });
  });
});
