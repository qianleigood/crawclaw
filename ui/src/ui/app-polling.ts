import type { CrawClawApp } from "./app.ts";
import { resolveAgentIdFromSessionKey } from "../../../src/routing/session-key.js";
import { loadAgentInspection } from "./controllers/agents.ts";
import { loadDebug } from "./controllers/debug.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { refreshWorkflowExecutionStatus } from "./controllers/workflows.ts";

type PollingHost = {
  nodesPollInterval: number | null;
  logsPollInterval: number | null;
  debugPollInterval: number | null;
  inspectPollInterval: number | null;
  workflowPollInterval: number | null;
  tab: string;
  connected?: boolean;
  agentsPanel?: string;
  agentsSelectedId?: string | null;
  sessionKey?: string;
  chatRunId?: string | null;
  agentInspectionLoading?: boolean;
  workflowSelectedExecutionId?: string | null;
  workflowSelectedExecution?: { executionId: string; status: string | null } | null;
  workflowStatusLoading?: boolean;
};

export function startNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval != null) {
    return;
  }
  host.nodesPollInterval = window.setInterval(
    () => void loadNodes(host as unknown as CrawClawApp, { quiet: true }),
    5000,
  );
}

export function stopNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval == null) {
    return;
  }
  clearInterval(host.nodesPollInterval);
  host.nodesPollInterval = null;
}

export function startLogsPolling(host: PollingHost) {
  if (host.logsPollInterval != null) {
    return;
  }
  host.logsPollInterval = window.setInterval(() => {
    if (host.tab !== "logs") {
      return;
    }
    void loadLogs(host as unknown as CrawClawApp, { quiet: true });
  }, 2000);
}

export function stopLogsPolling(host: PollingHost) {
  if (host.logsPollInterval == null) {
    return;
  }
  clearInterval(host.logsPollInterval);
  host.logsPollInterval = null;
}

export function startDebugPolling(host: PollingHost) {
  if (host.debugPollInterval != null) {
    return;
  }
  host.debugPollInterval = window.setInterval(() => {
    if (host.tab !== "debug") {
      return;
    }
    void loadDebug(host as unknown as CrawClawApp);
  }, 3000);
}

export function stopDebugPolling(host: PollingHost) {
  if (host.debugPollInterval == null) {
    return;
  }
  clearInterval(host.debugPollInterval);
  host.debugPollInterval = null;
}

function shouldPollWorkflowExecution(host: PollingHost): boolean {
  if (!host.connected || host.tab !== "workflows" || host.workflowStatusLoading) {
    return false;
  }
  const executionId = host.workflowSelectedExecutionId?.trim();
  const execution = host.workflowSelectedExecution;
  if (!executionId || !execution || execution.executionId !== executionId) {
    return false;
  }
  return !(
    execution.status === "succeeded" ||
    execution.status === "failed" ||
    execution.status === "cancelled"
  );
}

export function startWorkflowPolling(host: PollingHost) {
  if (host.workflowPollInterval != null) {
    return;
  }
  host.workflowPollInterval = window.setInterval(() => {
    if (!shouldPollWorkflowExecution(host)) {
      return;
    }
    void refreshWorkflowExecutionStatus(host as unknown as CrawClawApp);
  }, 3000);
}

export function stopWorkflowPolling(host: PollingHost) {
  if (host.workflowPollInterval == null) {
    return;
  }
  clearInterval(host.workflowPollInterval);
  host.workflowPollInterval = null;
}

function shouldPollAgentInspection(host: PollingHost): boolean {
  if (!host.connected || host.tab !== "agents" || host.agentsPanel !== "inspect") {
    return false;
  }
  const runId = host.chatRunId?.trim();
  const agentId = host.agentsSelectedId?.trim();
  const sessionKey = host.sessionKey?.trim();
  if (!runId || !agentId || !sessionKey) {
    return false;
  }
  return resolveAgentIdFromSessionKey(sessionKey) === agentId;
}

export function startInspectPolling(host: PollingHost) {
  if (host.inspectPollInterval != null) {
    return;
  }
  host.inspectPollInterval = window.setInterval(() => {
    if (!shouldPollAgentInspection(host) || host.agentInspectionLoading) {
      return;
    }
    const runId = host.chatRunId?.trim();
    if (!runId) {
      return;
    }
    void loadAgentInspection(host as unknown as CrawClawApp, { runId });
  }, 2500);
}

export function stopInspectPolling(host: PollingHost) {
  if (host.inspectPollInterval == null) {
    return;
  }
  clearInterval(host.inspectPollInterval);
  host.inspectPollInterval = null;
}

export function syncInspectPolling(host: PollingHost) {
  if (shouldPollAgentInspection(host)) {
    startInspectPolling(host);
  } else {
    stopInspectPolling(host);
  }
}

export function syncWorkflowPolling(host: PollingHost) {
  if (shouldPollWorkflowExecution(host)) {
    startWorkflowPolling(host);
  } else {
    stopWorkflowPolling(host);
  }
}
