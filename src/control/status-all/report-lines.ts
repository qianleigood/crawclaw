import { translateActiveCliText } from "../../terminal/i18n/text.js";
import type { ProgressReporter } from "../../terminal/progress.js";
import { getTerminalTableWidth, renderTable } from "../../terminal/table.js";
import { isRich, theme } from "../../terminal/theme.js";
import { appendStatusAllDiagnosis } from "./diagnosis.js";
import { formatTimeAgo } from "./format.js";

type OverviewRow = { Item: string; Value: string };

type AgentStatusLike = {
  agents: Array<{
    id: string;
    name?: string | null;
    bootstrapPending?: boolean | null;
    sessionsCount: number;
    lastActiveAgeMs?: number | null;
    sessionsPath: string;
  }>;
};

export async function buildStatusAllReportLines(params: {
  progress: ProgressReporter;
  overviewRows: OverviewRow[];
  agentStatus: AgentStatusLike;
  connectionDetailsForReport: string;
  diagnosis: Omit<
    Parameters<typeof appendStatusAllDiagnosis>[0],
    "lines" | "progress" | "muted" | "ok" | "warn" | "fail" | "connectionDetailsForReport"
  >;
}) {
  const rich = isRich();
  const tr = (text: string) => translateActiveCliText(text);
  const heading = (text: string) => (rich ? theme.heading(tr(text)) : tr(text));
  const ok = (text: string) => (rich ? theme.success(tr(text)) : tr(text));
  const warn = (text: string) => (rich ? theme.warn(tr(text)) : tr(text));
  const fail = (text: string) => (rich ? theme.error(tr(text)) : tr(text));
  const muted = (text: string) => (rich ? theme.muted(tr(text)) : tr(text));

  const tableWidth = getTerminalTableWidth();

  const overview = renderTable({
    width: tableWidth,
    columns: [
      { key: "Item", header: "Item", minWidth: 10 },
      { key: "Value", header: "Value", flex: true, minWidth: 24 },
    ],
    rows: params.overviewRows.map((row) => ({
      Item: tr(row.Item),
      Value: tr(row.Value),
    })),
  });

  const agentRows = params.agentStatus.agents.map((a) => ({
    Agent: a.name?.trim() ? `${a.id} (${a.name.trim()})` : a.id,
    BootstrapFile:
      a.bootstrapPending === true
        ? warn("PRESENT")
        : a.bootstrapPending === false
          ? ok("ABSENT")
          : "unknown",
    Sessions: String(a.sessionsCount),
    Active: a.lastActiveAgeMs != null ? formatTimeAgo(a.lastActiveAgeMs) : "unknown",
    Store: a.sessionsPath,
  }));

  const agentsTable = renderTable({
    width: tableWidth,
    columns: [
      { key: "Agent", header: "Agent", minWidth: 12 },
      { key: "BootstrapFile", header: "Bootstrap file", minWidth: 14 },
      { key: "Sessions", header: "Sessions", align: "right", minWidth: 8 },
      { key: "Active", header: "Active", minWidth: 10 },
      { key: "Store", header: "Store", flex: true, minWidth: 34 },
    ],
    rows: agentRows,
  });

  const lines: string[] = [];
  lines.push(heading("CrawClaw status --all"));
  lines.push("");
  lines.push(heading("Overview"));
  lines.push(overview.trimEnd());
  lines.push("");
  lines.push(heading("Agents"));
  lines.push(agentsTable.trimEnd());
  lines.push("");
  lines.push(heading("Diagnosis (read-only)"));

  await appendStatusAllDiagnosis({
    lines,
    progress: params.progress,
    muted,
    ok,
    warn,
    fail,
    connectionDetailsForReport: params.connectionDetailsForReport,
    ...params.diagnosis,
  });

  return lines;
}
