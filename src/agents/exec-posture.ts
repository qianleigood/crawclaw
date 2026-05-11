import type { CrawClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import {
  loadExecApprovals,
  type ExecAsk,
  type ExecHost,
  type ExecSecurity,
  type ExecTarget,
} from "../infra/exec-approvals.js";
import { resolveAgentConfig } from "./agent-scope.js";
import { resolveExecTarget } from "./bash-tools.exec-runtime.js";

export type ExecPosture = {
  host: ExecTarget;
  effectiveHost: ExecHost;
  security: ExecSecurity;
  ask: ExecAsk;
};

export function resolveExecPosture(params: {
  cfg: CrawClawConfig;
  sessionEntry?: SessionEntry;
  agentId?: string;
}): ExecPosture {
  const globalExec = params.cfg.tools?.exec;
  const agentExec = params.agentId
    ? resolveAgentConfig(params.cfg, params.agentId)?.tools?.exec
    : undefined;
  const host =
    (params.sessionEntry?.execHost as ExecTarget | undefined) ??
    (agentExec?.host as ExecTarget | undefined) ??
    (globalExec?.host as ExecTarget | undefined) ??
    "auto";
  const resolved = resolveExecTarget({
    configuredTarget: host,
    elevatedRequested: false,
  });
  const approvalDefaults = loadExecApprovals().defaults;
  const security =
    (params.sessionEntry?.execSecurity as ExecSecurity | undefined) ??
    (agentExec?.security as ExecSecurity | undefined) ??
    (globalExec?.security as ExecSecurity | undefined) ??
    approvalDefaults?.security ??
    "full";
  const ask =
    (params.sessionEntry?.execAsk as ExecAsk | undefined) ??
    (agentExec?.ask as ExecAsk | undefined) ??
    (globalExec?.ask as ExecAsk | undefined) ??
    approvalDefaults?.ask ??
    "off";
  return {
    host,
    effectiveHost: resolved.effectiveHost,
    security,
    ask,
  };
}

export function describeExecRiskDiagnostic(posture: ExecPosture): string | undefined {
  if (posture.security !== "full" || posture.ask !== "off") {
    return undefined;
  }
  return `Exec can run on ${posture.effectiveHost} without approval prompts. Prefer tools.exec.security="allowlist" with tools.exec.ask="on-miss" or "always".`;
}
