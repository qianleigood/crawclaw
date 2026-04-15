import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateHarnessPromotion,
  type HarnessPromotionDecision,
} from "../agents/harness/promotion-gate.js";
import { buildHarnessReport, type HarnessReport } from "../agents/harness/report.js";
import { getBuiltinHarnessScenarios } from "../agents/harness/scenario-runner.js";
import type { RuntimeEnv } from "../runtime.js";
import { writeRuntimeJson } from "../runtime.js";

type AgentsHarnessReportOptions = {
  json?: boolean;
  scenario?: string[];
};

type AgentsHarnessPromoteCheckOptions = {
  json?: boolean;
  baseline: string;
  candidate: string;
};

function trimScenarioNames(names: string[] | undefined): string[] {
  return [...new Set((names ?? []).map((name) => name.trim()).filter(Boolean))];
}

function resolveBuiltinHarnessScenarios(scenarioNames?: string[]) {
  const requested = trimScenarioNames(scenarioNames);
  const scenarios = getBuiltinHarnessScenarios();
  if (requested.length === 0) {
    return scenarios;
  }
  const byName = new Map(scenarios.map((scenario) => [scenario.name, scenario]));
  const selected = requested.map((name) => byName.get(name)).filter(Boolean);
  const missing = requested.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    const available = [...byName.keys()].toSorted().join(", ");
    throw new Error(
      `Unknown harness scenario(s): ${missing.join(", ")}. Available scenarios: ${available}`,
    );
  }
  return selected as typeof scenarios;
}

function formatHarnessReportText(report: HarnessReport): string {
  const summary = report.summary;
  const lines = [
    "Harness report:",
    `  Scenarios: ${summary.scenarioCount}`,
    `  Completion scenarios: ${summary.completionScenarioCount}`,
    `  Accepted: ${summary.acceptedCount}`,
    `  Waiting: ${summary.waitingCount}`,
    `  Incomplete: ${summary.incompleteCount}`,
    `  Loop signals: ${summary.loopSignalCount}`,
    `  Blocked scenarios: ${summary.blockedScenarioCount}`,
    `  Blocked events: ${summary.blockedEventCount}`,
    `  Completion mismatches: ${summary.completionMismatchCount}`,
    `  Avg tool calls/scenario: ${summary.avgToolCallsPerScenario.toFixed(2)}`,
    "",
    "Scenarios:",
  ];
  for (const scenario of report.scenarios) {
    lines.push(
      `  - ${scenario.name}: completion=${scenario.completionStatus ?? "n/a"}, loopEvents=${scenario.loopEventCount}, blocked=${scenario.blockedEventCount}, calls=${scenario.totalCalls}`,
    );
  }
  return lines.join("\n");
}

function formatDiffNumber(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function formatHarnessPromotionDecisionText(decision: HarnessPromotionDecision): string {
  const diff = decision.diff;
  const lines = [
    "Harness promote-check:",
    `  Verdict: ${decision.verdict}`,
    "  Reasons:",
    ...decision.reasons.map((reason) => `    - ${reason}`),
    "  Baseline:",
    `    accepted=${diff.baseline.acceptedCount} incomplete=${diff.baseline.incompleteCount} blockedScenarios=${diff.baseline.blockedScenarioCount} blockedEvents=${diff.baseline.blockedEventCount} mismatches=${diff.baseline.completionMismatchCount} avgCalls=${diff.baseline.avgToolCallsPerScenario.toFixed(2)}`,
    "  Candidate:",
    `    accepted=${diff.candidate.acceptedCount} incomplete=${diff.candidate.incompleteCount} blockedScenarios=${diff.candidate.blockedScenarioCount} blockedEvents=${diff.candidate.blockedEventCount} mismatches=${diff.candidate.completionMismatchCount} avgCalls=${diff.candidate.avgToolCallsPerScenario.toFixed(2)}`,
    "  Delta:",
    `    acceptedCount=${formatDiffNumber(diff.delta.acceptedCount)}`,
    `    incompleteCount=${formatDiffNumber(diff.delta.incompleteCount)}`,
    `    blockedScenarioCount=${formatDiffNumber(diff.delta.blockedScenarioCount)}`,
    `    blockedEventCount=${formatDiffNumber(diff.delta.blockedEventCount)}`,
    `    completionMismatchCount=${formatDiffNumber(diff.delta.completionMismatchCount)}`,
    `    avgToolCallsPerScenario=${diff.delta.avgToolCallsPerScenario.toFixed(2)}`,
  ];
  if (diff.changedScenarios.length > 0) {
    lines.push(
      "  Changed scenarios:",
      ...diff.changedScenarios.map((scenario) => `    - ${scenario.name}`),
    );
  }
  return lines.join("\n");
}

function assertHarnessReportShape(value: unknown, source: string): asserts value is HarnessReport {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid harness report in ${source}: expected a JSON object`);
  }
  const report = value as Partial<HarnessReport>;
  if (!Array.isArray(report.scenarios)) {
    throw new Error(`Invalid harness report in ${source}: missing scenarios array`);
  }
  if (!report.summary || typeof report.summary !== "object") {
    throw new Error(`Invalid harness report in ${source}: missing summary object`);
  }
  const summary = report.summary as Record<string, unknown>;
  for (const field of [
    "scenarioCount",
    "completionScenarioCount",
    "acceptedCount",
    "waitingCount",
    "incompleteCount",
    "loopSignalCount",
    "blockedScenarioCount",
    "blockedEventCount",
    "completionMismatchCount",
    "avgToolCallsPerScenario",
  ]) {
    if (typeof summary[field] !== "number") {
      throw new Error(`Invalid harness report in ${source}: summary.${field} must be a number`);
    }
  }
}

async function readHarnessReportFile(filePath: string): Promise<HarnessReport> {
  const resolved = path.resolve(filePath);
  const raw = await fs.readFile(resolved, "utf8");
  const parsed: unknown = JSON.parse(raw);
  assertHarnessReportShape(parsed, resolved);
  return parsed;
}

export async function agentsHarnessReportCommand(
  opts: AgentsHarnessReportOptions,
  runtime: RuntimeEnv,
) {
  const report = buildHarnessReport({
    scenarios: resolveBuiltinHarnessScenarios(opts.scenario),
    loopDetectionConfig: { enabled: true },
  });
  if (opts.json) {
    writeRuntimeJson(runtime, report);
    return report;
  }
  runtime.log(formatHarnessReportText(report));
  return report;
}

export async function agentsHarnessPromoteCheckCommand(
  opts: AgentsHarnessPromoteCheckOptions,
  runtime: RuntimeEnv,
) {
  const baseline = await readHarnessReportFile(opts.baseline);
  const candidate = await readHarnessReportFile(opts.candidate);
  const decision = evaluateHarnessPromotion({ baseline, candidate });
  if (opts.json) {
    writeRuntimeJson(runtime, decision);
    return decision;
  }
  runtime.log(formatHarnessPromotionDecisionText(decision));
  return decision;
}
