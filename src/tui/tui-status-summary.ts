import { formatTuiEnabledDisabled, translateTuiText } from "../cli/i18n/tui.js";
import { formatTimeAgo } from "../infra/format-time/format-relative.ts";
import { formatTokenCount } from "../utils/usage-format.js";
import { formatContextUsageLine } from "./tui-formatters.js";
import type { GatewayStatusSummary } from "./tui-types.js";

export function formatStatusSummary(summary: GatewayStatusSummary) {
  const lines: string[] = [];
  lines.push(translateTuiText("tui.status.gatewayStatus"));
  if (summary.runtimeVersion) {
    lines.push(translateTuiText("tui.status.version", { version: summary.runtimeVersion }));
  }

  if (!summary.linkChannel) {
    lines.push(translateTuiText("tui.status.linkChannelUnknown"));
  } else {
    const linkLabel = summary.linkChannel.label ?? translateTuiText("tui.status.linkChannel");
    const linked = summary.linkChannel.linked === true;
    const authAge =
      linked && typeof summary.linkChannel.authAgeMs === "number"
        ? ` (${translateTuiText("tui.status.lastRefreshed", {
            age: formatTimeAgo(summary.linkChannel.authAgeMs),
          })})`
        : "";
    lines.push(
      `${linkLabel}: ${
        linked ? translateTuiText("tui.common.linked") : translateTuiText("tui.common.notLinked")
      }${authAge}`,
    );
  }

  const providerSummary = Array.isArray(summary.providerSummary) ? summary.providerSummary : [];
  if (providerSummary.length > 0) {
    lines.push("");
    lines.push(translateTuiText("tui.status.system"));
    for (const line of providerSummary) {
      lines.push(`  ${line}`);
    }
  }

  const mainSessionWakeAgents = summary.mainSessionWake?.agents ?? [];
  if (mainSessionWakeAgents.length > 0) {
    const mainSessionWakeParts = mainSessionWakeAgents.map((agent) => {
      const agentId = agent.agentId ?? translateTuiText("tui.common.unknown");
      return `${formatTuiEnabledDisabled(Boolean(agent.enabled))} (${agentId})`;
    });
    lines.push("");
    lines.push(
      translateTuiText("tui.status.mainSessionWake", {
        value: mainSessionWakeParts.join(", "),
      }),
    );
  }

  const sessionPaths = summary.sessions?.paths ?? [];
  if (sessionPaths.length === 1) {
    lines.push(translateTuiText("tui.status.sessionStore", { path: sessionPaths[0] ?? "" }));
  } else if (sessionPaths.length > 1) {
    lines.push(translateTuiText("tui.status.sessionStores", { count: sessionPaths.length }));
  }

  const defaults = summary.sessions?.defaults;
  const defaultModel = defaults?.model ?? translateTuiText("tui.common.unknown");
  const defaultCtx =
    typeof defaults?.contextTokens === "number"
      ? ` (${formatTokenCount(defaults.contextTokens)} ctx)`
      : "";
  lines.push(translateTuiText("tui.status.defaultModel", { model: defaultModel, ctx: defaultCtx }));

  const sessionCount = summary.sessions?.count ?? 0;
  lines.push(translateTuiText("tui.status.activeSessions", { count: sessionCount }));

  const recent = Array.isArray(summary.sessions?.recent) ? summary.sessions?.recent : [];
  if (recent.length > 0) {
    lines.push(translateTuiText("tui.status.recentSessions"));
    for (const entry of recent) {
      const ageLabel =
        typeof entry.age === "number"
          ? formatTimeAgo(entry.age)
          : translateTuiText("tui.status.noActivity");
      const model = entry.model ?? translateTuiText("tui.common.unknown");
      const usage = formatContextUsageLine({
        total: entry.totalTokens ?? null,
        context: entry.contextTokens ?? null,
        remaining: entry.remainingTokens ?? null,
        percent: entry.percentUsed ?? null,
      });
      const flags = entry.flags?.length
        ? ` | ${translateTuiText("tui.status.flags", { flags: entry.flags.join(", ") })}`
        : "";
      lines.push(
        `- ${entry.key}${entry.kind ? ` [${entry.kind}]` : ""} | ${ageLabel} | ${translateTuiText("tui.common.model")} ${model} | ${usage}${flags}`,
      );
    }
  }

  const queued = Array.isArray(summary.queuedSystemEvents) ? summary.queuedSystemEvents : [];
  if (queued.length > 0) {
    const preview = queued.slice(0, 3).join(" | ");
    lines.push(
      translateTuiText("tui.status.queuedSystemEvents", {
        count: queued.length,
        preview,
      }),
    );
  }

  return lines;
}
