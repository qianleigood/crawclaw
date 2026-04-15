import type { ToolLoopDetectionConfig } from "../../config/types.tools.js";
import type { HarnessReplayResult } from "./replay.js";
import { runHarnessScenario, type HarnessScenario } from "./scenario-runner.js";

export type HarnessScenarioReport = {
  name: string;
  completionStatus?: HarnessReplayResult["completion"] extends infer T
    ? T extends { status: infer S }
      ? S
      : never
    : never;
  completionMatchesStored?: boolean;
  loopEventCount: number;
  blockedEventCount: number;
  totalCalls: number;
  uniquePatterns: number;
};

export type HarnessReportSummary = {
  scenarioCount: number;
  completionScenarioCount: number;
  acceptedCount: number;
  waitingCount: number;
  incompleteCount: number;
  loopSignalCount: number;
  blockedScenarioCount: number;
  blockedEventCount: number;
  completionMismatchCount: number;
  avgToolCallsPerScenario: number;
};

export type HarnessReport = {
  scenarios: HarnessScenarioReport[];
  summary: HarnessReportSummary;
};

export type HarnessReportDiff = {
  baseline: HarnessReportSummary;
  candidate: HarnessReportSummary;
  delta: {
    acceptedCount: number;
    waitingCount: number;
    incompleteCount: number;
    blockedScenarioCount: number;
    blockedEventCount: number;
    completionMismatchCount: number;
    avgToolCallsPerScenario: number;
  };
  changedScenarios: Array<{
    name: string;
    baseline: HarnessScenarioReport;
    candidate: HarnessScenarioReport;
  }>;
};

function toScenarioReport(
  scenario: HarnessScenario,
  result: HarnessReplayResult,
): HarnessScenarioReport {
  const blockedEventCount = result.loopEvents.filter((entry) => entry.blocked).length;
  return {
    name: scenario.name,
    ...(result.completion ? { completionStatus: result.completion.status } : {}),
    ...(typeof result.completionMatchesStored === "boolean"
      ? { completionMatchesStored: result.completionMatchesStored }
      : {}),
    loopEventCount: result.loopEvents.length,
    blockedEventCount,
    totalCalls: result.finalLoopStats.totalCalls,
    uniquePatterns: result.finalLoopStats.uniquePatterns,
  };
}

function buildSummary(scenarios: HarnessScenarioReport[]): HarnessReportSummary {
  const completionStatuses = scenarios
    .map((entry) => entry.completionStatus)
    .filter((entry): entry is NonNullable<HarnessScenarioReport["completionStatus"]> =>
      Boolean(entry),
    );
  const waitingCount = completionStatuses.filter(
    (status) => status === "waiting_user" || status === "waiting_external",
  ).length;
  const acceptedCount = completionStatuses.filter(
    (status) => status === "accepted" || status === "accepted_with_warnings",
  ).length;
  const incompleteCount = completionStatuses.filter((status) => status === "incomplete").length;
  const blockedScenarioCount = scenarios.filter((entry) => entry.blockedEventCount > 0).length;
  const blockedEventCount = scenarios.reduce((sum, entry) => sum + entry.blockedEventCount, 0);
  const totalCalls = scenarios.reduce((sum, entry) => sum + entry.totalCalls, 0);
  return {
    scenarioCount: scenarios.length,
    completionScenarioCount: completionStatuses.length,
    acceptedCount,
    waitingCount,
    incompleteCount,
    loopSignalCount: scenarios.filter((entry) => entry.loopEventCount > 0).length,
    blockedScenarioCount,
    blockedEventCount,
    completionMismatchCount: scenarios.filter((entry) => entry.completionMatchesStored === false)
      .length,
    avgToolCallsPerScenario: scenarios.length > 0 ? totalCalls / scenarios.length : 0,
  };
}

export function buildHarnessReport(params: {
  scenarios: HarnessScenario[];
  loopDetectionConfig?: ToolLoopDetectionConfig;
}): HarnessReport {
  const scenarioReports = params.scenarios.map((scenario) =>
    toScenarioReport(
      scenario,
      runHarnessScenario({
        scenario,
        loopDetectionConfig: params.loopDetectionConfig,
      }),
    ),
  );
  return {
    scenarios: scenarioReports,
    summary: buildSummary(scenarioReports),
  };
}

export function diffHarnessReports(params: {
  baseline: HarnessReport;
  candidate: HarnessReport;
}): HarnessReportDiff {
  const baselineByName = new Map(params.baseline.scenarios.map((entry) => [entry.name, entry]));
  const candidateByName = new Map(params.candidate.scenarios.map((entry) => [entry.name, entry]));
  const names = [...new Set([...baselineByName.keys(), ...candidateByName.keys()])].toSorted();
  const changedScenarios = names
    .map((name) => {
      const baseline = baselineByName.get(name);
      const candidate = candidateByName.get(name);
      if (!baseline || !candidate) {
        return undefined;
      }
      return JSON.stringify(baseline) === JSON.stringify(candidate)
        ? undefined
        : { name, baseline, candidate };
    })
    .filter(
      (
        entry,
      ): entry is {
        name: string;
        baseline: HarnessScenarioReport;
        candidate: HarnessScenarioReport;
      } => Boolean(entry),
    );

  return {
    baseline: params.baseline.summary,
    candidate: params.candidate.summary,
    delta: {
      acceptedCount: params.candidate.summary.acceptedCount - params.baseline.summary.acceptedCount,
      waitingCount: params.candidate.summary.waitingCount - params.baseline.summary.waitingCount,
      incompleteCount:
        params.candidate.summary.incompleteCount - params.baseline.summary.incompleteCount,
      blockedScenarioCount:
        params.candidate.summary.blockedScenarioCount -
        params.baseline.summary.blockedScenarioCount,
      blockedEventCount:
        params.candidate.summary.blockedEventCount - params.baseline.summary.blockedEventCount,
      completionMismatchCount:
        params.candidate.summary.completionMismatchCount -
        params.baseline.summary.completionMismatchCount,
      avgToolCallsPerScenario:
        params.candidate.summary.avgToolCallsPerScenario -
        params.baseline.summary.avgToolCallsPerScenario,
    },
    changedScenarios,
  };
}
