import { resolveMainSessionKey } from "../config/sessions/main-session.js";
import type { CrawClawConfig } from "../config/types.js";
import { listGatewayAgentsBasic } from "../gateway/agent-list.js";
import { resolveMainSessionWakeSummaryForAgent } from "../infra/main-session-wake-summary.js";
import { peekSystemEvents } from "../infra/system-events.js";
import type { UpdateCheckResult } from "../infra/update-check.js";
import { loggingState } from "../logging/state.js";
import { runExec } from "../process/exec.js";
import { createEmptyTaskAuditSummary } from "../tasks/task-registry.audit.shared.js";
import { createEmptyTaskRegistrySummary } from "../tasks/task-registry.summary.js";
import { resolveRuntimeServiceVersion } from "../version.js";
import { resolveFeishuCliStatusViaGateway } from "./feishu-cli-status.js";
import type { getAgentLocalStatuses as getAgentLocalStatusesFn } from "./status.agent-local.js";
import type { StatusScanResult } from "./status.scan.js";
import {
  buildTailscaleHttpsUrl,
  pickGatewaySelfPresence,
  resolveGatewayProbeSnapshot,
} from "./status.scan.shared.js";
import type { getStatusSummary as getStatusSummaryFn } from "./status.summary.js";

let pluginRegistryModulePromise: Promise<typeof import("../cli/plugin-registry.js")> | undefined;
let statusScanDepsRuntimeModulePromise:
  | Promise<typeof import("./status.scan.deps.runtime.js")>
  | undefined;
let statusAgentLocalModulePromise: Promise<typeof import("./status.agent-local.js")> | undefined;
let statusSummaryModulePromise: Promise<typeof import("./status.summary.js")> | undefined;
let statusUpdateModulePromise: Promise<typeof import("./status.update.js")> | undefined;
let gatewayCallModulePromise: Promise<typeof import("../gateway/call.js")> | undefined;

function loadPluginRegistryModule() {
  pluginRegistryModulePromise ??= import("../cli/plugin-registry.js");
  return pluginRegistryModulePromise;
}

function loadStatusScanDepsRuntimeModule() {
  statusScanDepsRuntimeModulePromise ??= import("./status.scan.deps.runtime.js");
  return statusScanDepsRuntimeModulePromise;
}

function loadStatusAgentLocalModule() {
  statusAgentLocalModulePromise ??= import("./status.agent-local.js");
  return statusAgentLocalModulePromise;
}

function loadStatusSummaryModule() {
  statusSummaryModulePromise ??= import("./status.summary.js");
  return statusSummaryModulePromise;
}

function loadStatusUpdateModule() {
  statusUpdateModulePromise ??= import("./status.update.js");
  return statusUpdateModulePromise;
}

function loadGatewayCallModule() {
  gatewayCallModulePromise ??= import("../gateway/call.js");
  return gatewayCallModulePromise;
}

export function buildColdStartUpdateResult(): UpdateCheckResult {
  return {
    root: null,
    installKind: "unknown",
    packageManager: "unknown",
  };
}

function buildColdStartAgentLocalStatuses(): Awaited<ReturnType<typeof getAgentLocalStatusesFn>> {
  return {
    defaultId: "main",
    agents: [],
    totalSessions: 0,
    bootstrapPendingCount: 0,
  };
}

function buildColdStartStatusSummary(): Awaited<ReturnType<typeof getStatusSummaryFn>> {
  return {
    runtimeVersion: null,
    mainSessionWake: {
      defaultAgentId: "main",
      agents: [],
    },
    channelSummary: [],
    queuedSystemEvents: [],
    tasks: createEmptyTaskRegistrySummary(),
    taskAudit: createEmptyTaskAuditSummary(),
    sessions: {
      paths: [],
      count: 0,
      defaults: { model: null, contextTokens: null },
      recent: [],
      byAgent: [],
    },
  };
}

function buildStatusJsonSnapshotSummary(params: {
  cfg: CrawClawConfig;
  agentStatus: Awaited<ReturnType<typeof getAgentLocalStatusesFn>>;
}): Awaited<ReturnType<typeof getStatusSummaryFn>> {
  const mainSessionWakeAgents = listGatewayAgentsBasic(params.cfg).agents.map((agent) => {
    const summary = resolveMainSessionWakeSummaryForAgent(params.cfg, agent.id);
    return {
      agentId: agent.id,
      enabled: summary.enabled,
    };
  });
  const sessionsByAgent = params.agentStatus.agents.map((agent) => ({
    agentId: agent.id,
    path: agent.sessionsPath,
    count: agent.sessionsCount,
    recent: [],
  }));

  return {
    runtimeVersion: resolveRuntimeServiceVersion(process.env),
    mainSessionWake: {
      defaultAgentId: params.agentStatus.defaultId,
      agents: mainSessionWakeAgents,
    },
    channelSummary: [],
    queuedSystemEvents: peekSystemEvents(resolveMainSessionKey(params.cfg)),
    tasks: createEmptyTaskRegistrySummary(),
    taskAudit: createEmptyTaskAuditSummary(),
    sessions: {
      paths: sessionsByAgent.map((agent) => agent.path),
      count: params.agentStatus.totalSessions,
      defaults: { model: null, contextTokens: null },
      recent: [],
      byAgent: sessionsByAgent,
    },
  };
}

export async function scanStatusJsonCore(params: {
  coldStart: boolean;
  cfg: CrawClawConfig;
  sourceConfig: CrawClawConfig;
  secretDiagnostics: string[];
  hasConfiguredChannels: boolean;
  opts: { timeoutMs?: number; all?: boolean; deep?: boolean };
  resolveOsSummary: () => StatusScanResult["osSummary"];
}): Promise<StatusScanResult> {
  const { cfg, sourceConfig, secretDiagnostics, hasConfiguredChannels, opts } = params;
  const shouldPreloadConfiguredChannelPlugins =
    hasConfiguredChannels && (opts.all === true || opts.deep === true);
  if (shouldPreloadConfiguredChannelPlugins) {
    const { ensurePluginRegistryLoaded } = await loadPluginRegistryModule();
    // Route plugin registration logs to stderr so they don't corrupt JSON on stdout.
    const previousForceStderr = loggingState.forceConsoleToStderr;
    loggingState.forceConsoleToStderr = true;
    try {
      ensurePluginRegistryLoaded({
        scope: "configured-channels",
        preferSetupRuntimeForChannelPlugins: true,
      });
    } finally {
      loggingState.forceConsoleToStderr = previousForceStderr;
    }
  }

  const osSummary = params.resolveOsSummary();
  const tailscaleMode = cfg.gateway?.tailscale?.mode ?? "off";
  const updateTimeoutMs = opts.all ? 6500 : 2500;
  const defaultSnapshotMode = opts.all !== true && opts.deep !== true;
  const skipUpdateChecks = opts.all !== true || (params.coldStart && !hasConfiguredChannels);
  const updatePromise = skipUpdateChecks
    ? Promise.resolve(buildColdStartUpdateResult())
    : loadStatusUpdateModule().then(({ getUpdateCheckResult }) =>
        getUpdateCheckResult({
          timeoutMs: updateTimeoutMs,
          fetchGit: true,
          includeRegistry: true,
        }),
      );
  const agentStatusPromise =
    params.coldStart && !hasConfiguredChannels && defaultSnapshotMode
      ? Promise.resolve(buildColdStartAgentLocalStatuses())
      : loadStatusAgentLocalModule().then(({ getAgentLocalStatuses }) =>
          getAgentLocalStatuses(cfg),
        );
  const summaryPromise =
    params.coldStart && !hasConfiguredChannels && defaultSnapshotMode
      ? Promise.resolve(buildColdStartStatusSummary())
      : defaultSnapshotMode
        ? Promise.resolve<Awaited<ReturnType<typeof getStatusSummaryFn>> | null>(null)
        : loadStatusSummaryModule().then(({ getStatusSummary }) =>
            getStatusSummary({ config: cfg, sourceConfig }),
          );
  const tailscaleDnsPromise =
    tailscaleMode === "off"
      ? Promise.resolve<string | null>(null)
      : loadStatusScanDepsRuntimeModule()
          .then(({ getTailnetHostname }) =>
            getTailnetHostname((cmd, args) =>
              runExec(cmd, args, { timeoutMs: 1200, maxBuffer: 200_000 }),
            ),
          )
          .catch(() => null);
  const gatewayProbePromise = resolveGatewayProbeSnapshot({
    cfg,
    opts: {
      ...opts,
      ...(defaultSnapshotMode ? { skipProbe: true } : {}),
    },
  });

  const [tailscaleDns, update, agentStatus, gatewaySnapshot, summary] = await Promise.all([
    tailscaleDnsPromise,
    updatePromise,
    agentStatusPromise,
    gatewayProbePromise,
    summaryPromise,
  ]);
  const resolvedSummary = summary ?? buildStatusJsonSnapshotSummary({ cfg, agentStatus });
  const tailscaleHttpsUrl = buildTailscaleHttpsUrl({
    tailscaleMode,
    tailscaleDns,
    controlUiBasePath: cfg.gateway?.controlUi?.basePath,
  });

  const {
    gatewayConnection,
    remoteUrlMissing,
    gatewayMode,
    gatewayProbeAuth,
    gatewayProbeAuthWarning,
    gatewayProbe,
  } = gatewaySnapshot;
  const gatewayReachable = gatewayProbe?.ok === true;
  const gatewaySelf = gatewayProbe?.presence
    ? pickGatewaySelfPresence(gatewayProbe.presence)
    : null;
  const feishuCli = gatewayReachable
    ? await loadGatewayCallModule().then(({ callGateway }) =>
        resolveFeishuCliStatusViaGateway({
          callGateway,
          config: cfg,
          gatewayReachable,
          timeoutMs: Math.min(8000, opts.timeoutMs ?? 10_000),
        }),
      )
    : null;
  // `status --json` does not serialize plugin compatibility notices, so keep
  // both routes off the full plugin status graph after the scoped preload.
  const pluginCompatibility: StatusScanResult["pluginCompatibility"] = [];

  return {
    cfg,
    sourceConfig,
    secretDiagnostics,
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
    channelIssues: [],
    agentStatus,
    channels: { rows: [], details: [] },
    summary: resolvedSummary,
    feishuCli,
    pluginCompatibility,
  };
}
