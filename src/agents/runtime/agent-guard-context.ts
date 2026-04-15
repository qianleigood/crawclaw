import { getAgentRunContext } from "../../infra/agent-events.js";
import { getTaskById } from "../../tasks/runtime-internal.js";
import type { AgentTaskMode, TaskRuntime } from "../../tasks/task-registry.types.js";
import { readAgentTaskCapabilitySnapshotSync } from "./agent-metadata-store.js";
import { getAgentRuntimeState } from "./agent-runtime-state.js";

export type AgentInteractiveApprovalBlocker = "heartbeat" | "background" | "hidden-control-ui";

export type AgentGuardCapability = {
  snapshotRef?: string;
  model?: string;
  sandboxed?: boolean;
  workspaceDir?: string;
  spawnSource?: string;
  requesterSessionKey?: string;
  requesterAgentIdOverride?: string;
};

export type AgentGuardContext = {
  runId?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runtime?: TaskRuntime;
  mode?: AgentTaskMode;
  sandboxed?: boolean;
  capability?: AgentGuardCapability;
  controlUiVisible: boolean;
  heartbeat: boolean;
  interactiveApprovalAvailable: boolean;
  interactiveApprovalBlocker?: AgentInteractiveApprovalBlocker;
  interactiveApprovalReason?: string;
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveAgentGuardContext(params?: {
  runId?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  sandboxed?: boolean;
}): AgentGuardContext {
  const runId = normalizeOptionalString(params?.runId);
  const runtimeState = runId ? getAgentRuntimeState(runId) : undefined;
  const runContext = runId ? getAgentRunContext(runId) : undefined;
  const controlUiVisible = runContext?.isControlUiVisible ?? true;
  const heartbeat = runContext?.isHeartbeat === true;
  const mode = runtimeState?.mode ?? runContext?.taskMode;
  const runtime = runtimeState?.runtime ?? runContext?.taskRuntime;
  const taskId = runtimeState?.taskId ?? runContext?.taskId;
  const agentId =
    runtimeState?.agentId ?? runContext?.agentId ?? normalizeOptionalString(params?.agentId);
  const sessionKey =
    runtimeState?.sessionKey ??
    runContext?.sessionKey ??
    normalizeOptionalString(params?.sessionKey);
  const sessionId =
    runtimeState?.sessionId ?? runContext?.sessionId ?? normalizeOptionalString(params?.sessionId);
  const task = taskId ? getTaskById(taskId) : undefined;
  const capabilitySnapshotRef = task?.agentMetadata?.capabilitySnapshotRef;
  const capabilitySnapshot = capabilitySnapshotRef
    ? readAgentTaskCapabilitySnapshotSync(capabilitySnapshotRef)
    : undefined;
  const sandboxed =
    capabilitySnapshot?.sandboxed ?? (params?.sandboxed === true ? true : undefined);
  const capability: AgentGuardCapability | undefined =
    capabilitySnapshot || capabilitySnapshotRef
      ? {
          ...(capabilitySnapshotRef ? { snapshotRef: capabilitySnapshotRef } : {}),
          ...(capabilitySnapshot?.model ? { model: capabilitySnapshot.model } : {}),
          ...(sandboxed ? { sandboxed } : {}),
          ...(capabilitySnapshot?.workspaceDir
            ? { workspaceDir: capabilitySnapshot.workspaceDir }
            : {}),
          ...(capabilitySnapshot?.spawnSource
            ? { spawnSource: capabilitySnapshot.spawnSource }
            : {}),
          ...(capabilitySnapshot?.requesterSessionKey
            ? { requesterSessionKey: capabilitySnapshot.requesterSessionKey }
            : {}),
          ...(capabilitySnapshot?.requesterAgentIdOverride
            ? { requesterAgentIdOverride: capabilitySnapshot.requesterAgentIdOverride }
            : {}),
        }
      : sandboxed
        ? { sandboxed }
        : undefined;

  const interactiveApprovalBlocker = heartbeat
    ? "heartbeat"
    : mode === "background"
      ? "background"
      : !controlUiVisible
        ? "hidden-control-ui"
        : undefined;
  const interactiveApprovalReason = interactiveApprovalBlocker
    ? formatAgentInteractiveApprovalUnavailableReason({
        blocker: interactiveApprovalBlocker,
        subject: "plugin",
      })
    : undefined;

  return {
    ...(runId ? { runId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(runtime ? { runtime } : {}),
    ...(mode ? { mode } : {}),
    ...(sandboxed ? { sandboxed } : {}),
    ...(capability ? { capability } : {}),
    controlUiVisible,
    heartbeat,
    interactiveApprovalAvailable: !interactiveApprovalBlocker,
    ...(interactiveApprovalBlocker ? { interactiveApprovalBlocker } : {}),
    ...(interactiveApprovalReason ? { interactiveApprovalReason } : {}),
  };
}

export function formatAgentInteractiveApprovalUnavailableReason(params: {
  blocker: AgentInteractiveApprovalBlocker;
  subject: "plugin" | "exec" | "interactive";
}): string {
  const prefix =
    params.subject === "plugin"
      ? "Plugin approval required, but"
      : params.subject === "exec"
        ? "Exec approval is required, but"
        : "Interactive approval is unavailable because";
  if (params.blocker === "heartbeat") {
    return `${prefix} interactive approvals are unavailable for heartbeat runs.`;
  }
  if (params.blocker === "background") {
    return `${prefix} interactive approvals are unavailable for background agent runs.`;
  }
  return `${prefix} interactive approvals are unavailable when control UI updates are hidden for this run.`;
}
