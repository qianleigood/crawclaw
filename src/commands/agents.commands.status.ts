import { buildAgentOpsSummary, type AgentOpsSummary, type AgentOpsSummaryRow } from "../agents/runtime/agent-ops-summary.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { shortenHomePath } from "../utils.js";
import { requireValidConfig } from "./agents.command-shared.js";

export type AgentsStatusOptions = {
  json?: boolean;
};

function formatCountList(values: Array<{ key: string; count: number }>): string[] {
  return values.map((entry) => `    - ${entry.key}: ${entry.count}`);
}

function formatAgentStatusRow(row: AgentOpsSummaryRow): string[] {
  const defaultTag = row.isDefault ? " (default)" : "";
  const header = row.name && row.name !== row.id ? `${row.id}${defaultTag} (${row.name})` : `${row.id}${defaultTag}`;
  const lines = [`- ${header}`];
  if (row.workspaceDir) {
    lines.push(`  Workspace: ${shortenHomePath(row.workspaceDir)}`);
  }
  lines.push(`  Sessions: ${row.sessionsCount}`);
  if (row.lastActiveAgeMs != null) {
    lines.push(`  Last activity age: ${Math.round(row.lastActiveAgeMs / 1000)}s`);
  }
  if (row.bootstrapPending != null) {
    lines.push(`  Bootstrap pending: ${row.bootstrapPending ? "yes" : "no"}`);
  }
  lines.push(
    `  Runtime: total=${row.runtimeSummary.total} active=${row.runtimeSummary.active} stale=${row.runtimeSummary.stale}`,
  );
  lines.push(
    `  Tasks: total=${row.taskSummary.total} active=${row.taskSummary.active} failures=${row.taskSummary.failures}`,
  );
  if (row.guardBlockers.length > 0) {
    lines.push("  Guard blockers:");
    lines.push(...formatCountList(row.guardBlockers));
  }
  if (row.completionBlockers.length > 0) {
    lines.push("  Completion blockers:");
    lines.push(...formatCountList(row.completionBlockers));
  }
  if (row.loopWarnings.length > 0) {
    lines.push("  Loop warnings:");
    lines.push(...formatCountList(row.loopWarnings));
  }
  return lines;
}

export function formatAgentsStatusSummary(summary: AgentOpsSummary): string {
  const lines = [
    "Agent Ops Summary:",
    `- Generated: ${new Date(summary.generatedAt).toISOString()}`,
    `- Default agent: ${summary.defaultId}`,
    `- Runtime: total=${summary.runtimeSummary.total} active=${summary.runtimeSummary.active} stale=${summary.runtimeSummary.stale}`,
    `- Tasks: total=${summary.taskSummary.total} active=${summary.taskSummary.active} failures=${summary.taskSummary.failures}`,
    "Agents:",
  ];
  for (const agent of summary.agents) {
    lines.push(...formatAgentStatusRow(agent));
  }
  return lines.join("\n");
}

export async function agentsStatusCommand(
  opts: AgentsStatusOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<AgentOpsSummary | undefined> {
  const cfg = await requireValidConfig(runtime);
  if (!cfg) {
    return undefined;
  }
  const summary = await buildAgentOpsSummary(cfg);
  if (opts.json) {
    writeRuntimeJson(runtime, summary);
  } else {
    runtime.log(formatAgentsStatusSummary(summary));
  }
  return summary;
}
