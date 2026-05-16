import type { CrawClawConfig } from "../config/types.js";
import type { GatewayConnectionDetails } from "../gateway/connection-details.js";
import type { UpdateCheckResult } from "../infra/update-check.js";
import type { PluginCompatibilityNotice } from "../plugins/status.js";
import type { AgentLocalStatus } from "./status.agent-local.js";

export type SessionStatus = {
  key: string;
  kind: string;
  updatedAt: number | null;
  age: number;
  model: string | null;
  modelProvider?: string | null;
  totalTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  contextTokens?: number | null;
  percentUsed?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
};

export type StatusSummary = {
  runtimeVersion: string | null;
  mainSessionWake: {
    defaultAgentId: string;
    agents: Array<{ agentId: string; enabled: boolean }>;
  };
  queuedSystemEvents: unknown[];
  tasks: {
    total: number;
    active: number;
    failures: number;
    byStatus: {
      queued: number;
      running: number;
    };
  };
  taskAudit: {
    errors: number;
    warnings: number;
  };
  sessions: {
    paths: string[];
    count: number;
    defaults: {
      model: string | null;
      contextTokens: number | null;
    };
    recent: SessionStatus[];
    byAgent: Array<{
      agentId: string;
      path: string;
      count: number;
      recent: SessionStatus[];
    }>;
  };
};

export type StatusScanResult = {
  cfg: CrawClawConfig;
  sourceConfig: CrawClawConfig;
  secretDiagnostics: string[];
  osSummary: { label: string };
  tailscaleMode: string;
  tailscaleDns: string | null;
  tailscaleHttpsUrl: string | null;
  update: UpdateCheckResult;
  gatewayConnection: GatewayConnectionDetails;
  remoteUrlMissing: boolean;
  gatewayMode: "local" | "remote";
  gatewayProbeAuth: {
    token?: string;
    password?: string;
  };
  gatewayProbeAuthWarning?: string;
  gatewayProbe: Awaited<ReturnType<typeof import("../gateway/probe.js").probeGateway>> | null;
  gatewayReachable: boolean;
  gatewaySelf: {
    host?: string | null;
    ip?: string | null;
    version?: string | null;
    platform?: string | null;
  } | null;
  agentStatus: {
    defaultId: string;
    agents: AgentLocalStatus[];
    totalSessions: number;
    bootstrapPendingCount: number;
  };
  summary: StatusSummary;
  pluginCompatibility: PluginCompatibilityNotice[];
};
