import type { MainSessionWakeEventPayload } from "../infra/main-session-wake-events.js";
import { normalizeUpdateChannel, resolveUpdateChannelDisplay } from "../infra/update-track.js";
import { type RuntimeEnv, writeRuntimeJson } from "../runtime.js";
import { createCliTranslator, getActiveCliLocale } from "../terminal/i18n/index.js";
import { withProgress } from "../terminal/progress.js";

type HealthSummary = {
  durationMs?: number;
};

let providerUsagePromise: Promise<typeof import("../infra/provider-usage.js")> | undefined;
let securityAuditModulePromise: Promise<typeof import("../security/audit.runtime.js")> | undefined;
let gatewayCallModulePromise: Promise<typeof import("../gateway/call.js")> | undefined;
let statusScanModulePromise: Promise<typeof import("./status.scan.js")> | undefined;
let statusScanFastJsonModulePromise:
  | Promise<typeof import("./status.scan.fast-json.js")>
  | undefined;
let statusAllModulePromise: Promise<typeof import("./status-all.js")> | undefined;
let statusCommandTextRuntimePromise:
  | Promise<typeof import("./status.command.text-runtime.js")>
  | undefined;

function loadProviderUsage() {
  providerUsagePromise ??= import("../infra/provider-usage.js");
  return providerUsagePromise;
}

function loadSecurityAuditModule() {
  securityAuditModulePromise ??= import("../security/audit.runtime.js");
  return securityAuditModulePromise;
}

function loadGatewayCallModule() {
  gatewayCallModulePromise ??= import("../gateway/call.js");
  return gatewayCallModulePromise;
}

function loadStatusScanModule() {
  statusScanModulePromise ??= import("./status.scan.js");
  return statusScanModulePromise;
}

function loadStatusScanFastJsonModule() {
  statusScanFastJsonModulePromise ??= import("./status.scan.fast-json.js");
  return statusScanFastJsonModulePromise;
}

function loadStatusAllModule() {
  statusAllModulePromise ??= import("./status-all.js");
  return statusAllModulePromise;
}

function loadStatusCommandTextRuntime() {
  statusCommandTextRuntimePromise ??= import("./status.command.text-runtime.js");
  return statusCommandTextRuntimePromise;
}

export async function statusCommand(
  opts: {
    json?: boolean;
    deep?: boolean;
    usage?: boolean;
    timeoutMs?: number;
    verbose?: boolean;
    all?: boolean;
  },
  runtime: RuntimeEnv,
) {
  if (opts.all && !opts.json) {
    await loadStatusAllModule().then(({ statusAllCommand }) =>
      statusAllCommand(runtime, { timeoutMs: opts.timeoutMs }),
    );
    return;
  }

  const scan = opts.json
    ? await loadStatusScanFastJsonModule().then(({ scanStatusJsonFast }) =>
        scanStatusJsonFast({ timeoutMs: opts.timeoutMs, all: opts.all, deep: opts.deep }, runtime),
      )
    : await loadStatusScanModule().then(({ scanStatus }) =>
        scanStatus({ json: false, timeoutMs: opts.timeoutMs, all: opts.all }, runtime),
      );
  const runSecurityAudit = async () =>
    await loadSecurityAuditModule().then(({ runSecurityAudit }) =>
      runSecurityAudit({
        config: scan.cfg,
        sourceConfig: scan.sourceConfig,
        deep: false,
        includeFilesystem: true,
        includeChannelSecurity: false,
      }),
    );
  const securityAudit = opts.json
    ? await runSecurityAudit()
    : await withProgress(
        {
          label: "Running security audit…",
          indeterminate: true,
          enabled: true,
        },
        async () => await runSecurityAudit(),
      );
  const {
    cfg,
    osSummary,
    tailscaleMode,
    tailscaleDns,
    tailscaleHttpsUrl,
    update,
    gatewayConnection,
    remoteUrlMissing,
    gatewayMode,
    gatewayProbeAuth,
    gatewayProbeAuthWarning,
    gatewayProbe,
    gatewayReachable,
    gatewaySelf,
    agentStatus,
    summary,
    secretDiagnostics,
    pluginCompatibility,
  } = scan;

  const usage = opts.usage
    ? await withProgress(
        {
          label: "Fetching usage snapshot…",
          indeterminate: true,
          enabled: opts.json !== true,
        },
        async () => {
          const { loadProviderUsageSummary } = await loadProviderUsage();
          return await loadProviderUsageSummary({ timeoutMs: opts.timeoutMs });
        },
      )
    : undefined;
  const health: HealthSummary | undefined = opts.deep
    ? await withProgress(
        {
          label: "Checking gateway health…",
          indeterminate: true,
          enabled: opts.json !== true,
        },
        async () => {
          const { callGateway } = await loadGatewayCallModule();
          return await callGateway<HealthSummary>({
            method: "health",
            params: { probe: true },
            timeoutMs: opts.timeoutMs,
            config: scan.cfg,
          });
        },
      )
    : undefined;
  const lastMainSessionWake =
    opts.deep && gatewayReachable
      ? await loadGatewayCallModule()
          .then(({ callGateway }) =>
            callGateway<MainSessionWakeEventPayload | null>({
              method: "last-main-session-wake",
              params: {},
              timeoutMs: opts.timeoutMs,
              config: scan.cfg,
            }),
          )
          .catch(() => null)
      : null;

  const configChannel = normalizeUpdateChannel(cfg.update?.channel);
  const channelInfo = resolveUpdateChannelDisplay({
    configChannel,
    installKind: update.installKind,
    gitTag: update.git?.tag ?? null,
    gitBranch: update.git?.branch ?? null,
  });

  if (opts.json) {
    writeRuntimeJson(runtime, {
      ...summary,
      os: osSummary,
      update,
      updateChannel: channelInfo.channel,
      updateChannelSource: channelInfo.source,
      gateway: {
        mode: gatewayMode,
        url: gatewayConnection.url,
        urlSource: gatewayConnection.urlSource,
        misconfigured: remoteUrlMissing,
        reachable: gatewayReachable,
        connectLatencyMs: gatewayProbe?.connectLatencyMs ?? null,
        self: gatewaySelf,
        error: gatewayProbe?.error ?? null,
        authWarning: gatewayProbeAuthWarning ?? null,
      },
      agents: agentStatus,
      securityAudit,
      secretDiagnostics,
      pluginCompatibility: {
        count: pluginCompatibility.length,
        warnings: pluginCompatibility,
      },
      ...(health || usage || lastMainSessionWake ? { health, usage, lastMainSessionWake } : {}),
    });
    return;
  }

  const rich = true;
  const {
    formatCliCommand,
    formatDuration,
    formatGatewayAuthUsed,
    formatGitInstallLabel,
    formatKTokens,
    formatPluginCompatibilityNotice,
    formatTimeAgo,
    formatTokensCompact,
    formatUpdateAvailableHint,
    formatUpdateOneLiner,
    getTerminalTableWidth,
    info,
    renderTable,
    resolveUpdateAvailability,
    shortenText,
    summarizePluginCompatibility,
    theme,
  } = await loadStatusCommandTextRuntime();
  const muted = (value: string) => (rich ? theme.muted(value) : value);
  const ok = (value: string) => (rich ? theme.success(value) : value);
  const warn = (value: string) => (rich ? theme.warn(value) : value);

  if (opts.verbose) {
    const { buildGatewayConnectionDetails } = await loadGatewayCallModule();
    const details = buildGatewayConnectionDetails({ config: scan.cfg });
    runtime.log(info("Gateway connection:"));
    for (const line of details.message.split("\n")) {
      runtime.log(`  ${line}`);
    }
    runtime.log("");
  }

  const tableWidth = getTerminalTableWidth();

  if (secretDiagnostics.length > 0) {
    runtime.log(theme.warn("Secret diagnostics:"));
    for (const entry of secretDiagnostics) {
      runtime.log(`- ${entry}`);
    }
    runtime.log("");
  }

  const gatewayValue = (() => {
    const target = remoteUrlMissing
      ? `fallback ${gatewayConnection.url}`
      : `${gatewayConnection.url}${gatewayConnection.urlSource ? ` (${gatewayConnection.urlSource})` : ""}`;
    const reach = remoteUrlMissing
      ? warn("misconfigured (remote.url missing)")
      : gatewayReachable
        ? ok(`reachable ${formatDuration(gatewayProbe?.connectLatencyMs)}`)
        : warn(gatewayProbe?.error ? `unreachable (${gatewayProbe.error})` : "unreachable");
    const auth =
      gatewayReachable && !remoteUrlMissing
        ? ` · auth ${formatGatewayAuthUsed(gatewayProbeAuth)}`
        : "";
    const self =
      gatewaySelf?.host || gatewaySelf?.version || gatewaySelf?.platform
        ? [
            gatewaySelf?.host ? gatewaySelf.host : null,
            gatewaySelf?.ip ? `(${gatewaySelf.ip})` : null,
            gatewaySelf?.version ? `app ${gatewaySelf.version}` : null,
            gatewaySelf?.platform ? gatewaySelf.platform : null,
          ]
            .filter(Boolean)
            .join(" ")
        : null;
    const suffix = self ? ` · ${self}` : "";
    return `${gatewayMode} · ${target} · ${reach}${auth}${suffix}`;
  })();
  const agentsValue = (() => {
    const pending =
      agentStatus.bootstrapPendingCount > 0
        ? `${agentStatus.bootstrapPendingCount} bootstrap file${agentStatus.bootstrapPendingCount === 1 ? "" : "s"} present`
        : "no bootstrap files";
    const def = agentStatus.agents.find((a) => a.id === agentStatus.defaultId);
    const defActive = def?.lastActiveAgeMs != null ? formatTimeAgo(def.lastActiveAgeMs) : "unknown";
    const defSuffix = def ? ` · default ${def.id} active ${defActive}` : "";
    return `${agentStatus.agents.length} · ${pending} · sessions ${agentStatus.totalSessions}${defSuffix}`;
  })();
  const defaults = summary.sessions.defaults;
  const defaultCtx = defaults.contextTokens
    ? ` (${formatKTokens(defaults.contextTokens)} ctx)`
    : "";
  const eventsValue =
    summary.queuedSystemEvents.length > 0 ? `${summary.queuedSystemEvents.length} queued` : "none";
  const tasksValue =
    summary.tasks.total > 0
      ? [
          `${summary.tasks.active} active`,
          `${summary.tasks.byStatus.queued} queued`,
          `${summary.tasks.byStatus.running} running`,
          summary.tasks.failures > 0
            ? warn(`${summary.tasks.failures} issue${summary.tasks.failures === 1 ? "" : "s"}`)
            : muted("no issues"),
          summary.taskAudit.errors > 0
            ? warn(
                `audit ${summary.taskAudit.errors} error${summary.taskAudit.errors === 1 ? "" : "s"} · ${summary.taskAudit.warnings} warn`,
              )
            : summary.taskAudit.warnings > 0
              ? muted(`audit ${summary.taskAudit.warnings} warn`)
              : muted("audit clean"),
          `${summary.tasks.total} tracked`,
        ].join(" · ")
      : muted("none");

  const probesValue = health ? ok("enabled") : muted("skipped (use --deep)");

  const mainSessionWakeValue = (() => {
    const parts = summary.mainSessionWake.agents
      .map((agent) => {
        if (!agent.enabled) {
          return `disabled (${agent.agentId})`;
        }
        return `enabled (${agent.agentId})`;
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "disabled";
  })();
  const lastMainSessionWakeValue = (() => {
    if (!opts.deep) {
      return null;
    }
    if (!gatewayReachable) {
      return warn("unavailable");
    }
    if (!lastMainSessionWake) {
      return muted("none");
    }
    const age = formatTimeAgo(Date.now() - lastMainSessionWake.ts);
    const channel = lastMainSessionWake.channel ?? "unknown";
    const accountLabel = lastMainSessionWake.accountId
      ? `account ${lastMainSessionWake.accountId}`
      : null;
    return [lastMainSessionWake.status, `${age} ago`, channel, accountLabel]
      .filter(Boolean)
      .join(" · ");
  })();

  const storeLabel =
    summary.sessions.paths.length > 1
      ? `${summary.sessions.paths.length} stores`
      : (summary.sessions.paths[0] ?? "unknown");

  const updateAvailability = resolveUpdateAvailability(update);
  const updateLine = formatUpdateOneLiner(update).replace(/^Update:\s*/i, "");
  const channelLabel = channelInfo.label;
  const gitLabel = formatGitInstallLabel(update);
  const pluginCompatibilitySummary = summarizePluginCompatibility(pluginCompatibility);
  const pluginCompatibilityValue =
    pluginCompatibilitySummary.noticeCount === 0
      ? ok("none")
      : warn(
          `${pluginCompatibilitySummary.noticeCount} notice${pluginCompatibilitySummary.noticeCount === 1 ? "" : "s"} · ${pluginCompatibilitySummary.pluginCount} plugin${pluginCompatibilitySummary.pluginCount === 1 ? "" : "s"}`,
        );

  const overviewRows = [
    { Item: "OS", Value: `${osSummary.label} · node ${process.versions.node}` },
    {
      Item: "Tailscale",
      Value:
        tailscaleMode === "off"
          ? muted("off")
          : tailscaleDns && tailscaleHttpsUrl
            ? `${tailscaleMode} · ${tailscaleDns} · ${tailscaleHttpsUrl}`
            : warn(`${tailscaleMode} · magicdns unknown`),
    },
    { Item: "Channel", Value: channelLabel },
    ...(gitLabel ? [{ Item: "Git", Value: gitLabel }] : []),
    {
      Item: "Update",
      Value: updateAvailability.available ? warn(`available · ${updateLine}`) : updateLine,
    },
    { Item: "Gateway", Value: gatewayValue },
    ...(gatewayProbeAuthWarning
      ? [{ Item: "Gateway auth warning", Value: warn(gatewayProbeAuthWarning) }]
      : []),
    { Item: "Agents", Value: agentsValue },
    { Item: "Plugin compatibility", Value: pluginCompatibilityValue },
    { Item: "Probes", Value: probesValue },
    { Item: "Events", Value: eventsValue },
    { Item: "Tasks", Value: tasksValue },
    { Item: "Main-session wake", Value: mainSessionWakeValue },
    ...(lastMainSessionWakeValue
      ? [{ Item: "Last main-session wake", Value: lastMainSessionWakeValue }]
      : []),
    {
      Item: "Sessions",
      Value: `${summary.sessions.count} active · default ${defaults.model ?? "unknown"}${defaultCtx} · ${storeLabel}`,
    },
  ];

  runtime.log(theme.heading("CrawClaw status"));
  runtime.log("");
  runtime.log(theme.heading("Overview"));
  runtime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Item", header: "Item", minWidth: 12 },
        { key: "Value", header: "Value", flex: true, minWidth: 32 },
      ],
      rows: overviewRows,
    }).trimEnd(),
  );
  if (summary.taskAudit.errors > 0) {
    runtime.log("");
    runtime.log(
      theme.muted(`Task maintenance: ${formatCliCommand("crawclaw tasks maintenance --apply")}`),
    );
  }

  if (pluginCompatibility.length > 0) {
    runtime.log("");
    runtime.log(theme.heading("Plugin compatibility"));
    for (const notice of pluginCompatibility.slice(0, 8)) {
      const label = notice.severity === "warn" ? theme.warn("WARN") : theme.muted("INFO");
      runtime.log(`  ${label} ${formatPluginCompatibilityNotice(notice)}`);
    }
    if (pluginCompatibility.length > 8) {
      runtime.log(theme.muted(`  … +${pluginCompatibility.length - 8} more`));
    }
  }

  runtime.log("");
  runtime.log(theme.heading("Security audit"));
  const fmtSummary = (value: { critical: number; warn: number; info: number }) => {
    const parts = [
      theme.error(`${value.critical} critical`),
      theme.warn(`${value.warn} warn`),
      theme.muted(`${value.info} info`),
    ];
    return parts.join(" · ");
  };
  runtime.log(theme.muted(`Summary: ${fmtSummary(securityAudit.summary)}`));
  const importantFindings = securityAudit.findings.filter(
    (f) => f.severity === "critical" || f.severity === "warn",
  );
  if (importantFindings.length === 0) {
    runtime.log(theme.muted("No critical or warn findings detected."));
  } else {
    const severityLabel = (sev: "critical" | "warn" | "info") => {
      if (sev === "critical") {
        return theme.error("CRITICAL");
      }
      if (sev === "warn") {
        return theme.warn("WARN");
      }
      return theme.muted("INFO");
    };
    const sevRank = (sev: "critical" | "warn" | "info") =>
      sev === "critical" ? 0 : sev === "warn" ? 1 : 2;
    const sorted = [...importantFindings].toSorted(
      (a, b) => sevRank(a.severity) - sevRank(b.severity),
    );
    const shown = sorted.slice(0, 6);
    for (const f of shown) {
      runtime.log(`  ${severityLabel(f.severity)} ${f.title}`);
      runtime.log(`    ${shortenText(f.detail.replaceAll("\n", " "), 160)}`);
      if (f.remediation?.trim()) {
        runtime.log(`    ${theme.muted(`Fix: ${f.remediation.trim()}`)}`);
      }
    }
    if (sorted.length > shown.length) {
      runtime.log(theme.muted(`… +${sorted.length - shown.length} more`));
    }
  }
  runtime.log(theme.muted(`Full report: ${formatCliCommand("crawclaw security audit")}`));
  runtime.log(theme.muted(`Deep probe: ${formatCliCommand("crawclaw security audit --deep")}`));

  runtime.log("");
  runtime.log(theme.heading("Sessions"));
  runtime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Key", header: "Key", minWidth: 20, flex: true },
        { key: "Kind", header: "Kind", minWidth: 6 },
        { key: "Age", header: "Age", minWidth: 9 },
        { key: "Model", header: "Model", minWidth: 14 },
        { key: "Tokens", header: "Tokens", minWidth: 16 },
      ],
      rows:
        summary.sessions.recent.length > 0
          ? summary.sessions.recent.map((sess) => ({
              Key: shortenText(sess.key, 32),
              Kind: sess.kind,
              Age: sess.updatedAt ? formatTimeAgo(sess.age) : "no activity",
              Model: sess.model ?? "unknown",
              Tokens: formatTokensCompact(sess),
            }))
          : [
              {
                Key: muted("no sessions yet"),
                Kind: "",
                Age: "",
                Model: "",
                Tokens: "",
              },
            ],
    }).trimEnd(),
  );

  if (summary.queuedSystemEvents.length > 0) {
    runtime.log("");
    runtime.log(theme.heading("System events"));
    runtime.log(
      renderTable({
        width: tableWidth,
        columns: [{ key: "Event", header: "Event", flex: true, minWidth: 24 }],
        rows: summary.queuedSystemEvents.slice(0, 5).map((event) => ({
          Event: String(event),
        })),
      }).trimEnd(),
    );
    if (summary.queuedSystemEvents.length > 5) {
      runtime.log(muted(`… +${summary.queuedSystemEvents.length - 5} more`));
    }
  }

  if (health) {
    runtime.log("");
    runtime.log(theme.heading("Health"));
    const rows: Array<Record<string, string>> = [];
    rows.push({
      Item: "Gateway",
      Status: ok("reachable"),
      Detail: typeof health.durationMs === "number" ? `${health.durationMs}ms` : "",
    });

    runtime.log(
      renderTable({
        width: tableWidth,
        columns: [
          { key: "Item", header: "Item", minWidth: 10 },
          { key: "Status", header: "Status", minWidth: 8 },
          { key: "Detail", header: "Detail", flex: true, minWidth: 28 },
        ],
        rows,
      }).trimEnd(),
    );
  }

  if (usage) {
    const { formatUsageReportLines } = await loadProviderUsage();
    runtime.log("");
    runtime.log(theme.heading("Usage"));
    for (const line of formatUsageReportLines(usage)) {
      runtime.log(line);
    }
  }

  runtime.log("");
  runtime.log("FAQ: https://docs.crawclaw.ai/faq");
  runtime.log("Troubleshooting: https://docs.crawclaw.ai/troubleshooting");
  runtime.log("");
  const updateHint = formatUpdateAvailableHint(update);
  if (updateHint) {
    runtime.log(theme.warn(updateHint));
    runtime.log("");
  }
  const t = createCliTranslator(getActiveCliLocale());
  runtime.log("Next steps:");
  runtime.log(
    `  ${t("status.next.needShare").padEnd(19)} ${formatCliCommand("crawclaw status --all")}`,
  );
  runtime.log(
    `  ${t("status.next.needDebugLive").padEnd(19)} ${formatCliCommand("crawclaw logs --follow")}`,
  );
  if (gatewayReachable) {
    runtime.log(
      `  ${"Need deeper status?".padEnd(19)} ${formatCliCommand("crawclaw status --deep")}`,
    );
  } else {
    runtime.log(
      `  ${t("status.next.fixReachabilityFirst")}: ${formatCliCommand("crawclaw gateway probe")}`,
    );
  }
}
