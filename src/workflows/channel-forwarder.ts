import type { AgentActionStatus } from "../agents/action-feed/types.js";
import { resolveDeliverableTarget } from "../channels/deliverable-target.js";
import { buildWorkflowReplyPayload } from "../channels/workflow-projection.js";
import type { CrawClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import {
  resolveExecApprovalSessionTarget,
  type ExecApprovalSessionTarget,
} from "../infra/exec-approval-session-target.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";
import { buildWorkflowChannelControlCommands } from "./channel-controls.js";
import {
  buildWorkflowDiscordResumeCallbackData,
  ensureWorkflowInteractiveHandlersRegistered,
} from "./interactive.js";
import type { WorkflowExecutionRecord, WorkflowExecutionVisibilityMode } from "./types.js";

const log = createSubsystemLogger("workflows/channel-forwarder");

type WorkflowChannelForwardStatus = AgentActionStatus;

type WorkflowChannelForwardTarget = ExecApprovalSessionTarget;

type WorkflowChannelForwardAction = {
  actionId: string;
  parentActionId?: string;
  status: WorkflowChannelForwardStatus;
  title: string;
  summary?: string;
  projectedTitle?: string;
  projectedSummary?: string;
  detail?: Record<string, unknown>;
};

export type WorkflowChannelForwarderDeps = {
  getConfig?: () => CrawClawConfig;
  deliver?: typeof deliverOutboundPayloads;
  resolveSessionTarget?: (params: {
    cfg: CrawClawConfig;
    record: WorkflowExecutionRecord;
  }) => WorkflowChannelForwardTarget | null;
};

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveForwardMode(record: WorkflowExecutionRecord): WorkflowExecutionVisibilityMode {
  const mode = normalizeOptionalString(record.originVisibilityMode);
  if (mode === "summary" || mode === "verbose" || mode === "full") {
    return mode;
  }
  return "off";
}

function resolveActionScope(
  action: WorkflowChannelForwardAction,
): "workflow" | "step" | "compensation" {
  const stepId = normalizeOptionalString(action.detail?.stepId);
  if (!stepId) {
    return "workflow";
  }
  return normalizeOptionalString(action.detail?.compensationStatus) ? "compensation" : "step";
}

function shouldForwardStatus(status: WorkflowChannelForwardStatus): boolean {
  return (
    status === "waiting" || status === "completed" || status === "failed" || status === "cancelled"
  );
}

function shouldForwardAction(params: {
  record: WorkflowExecutionRecord;
  action: WorkflowChannelForwardAction;
}): boolean {
  const mode = resolveForwardMode(params.record);
  if (mode === "off") {
    return false;
  }
  if (!normalizeOptionalString(params.record.originSessionKey)) {
    return false;
  }
  if (!shouldForwardStatus(params.action.status)) {
    return false;
  }
  const scope = resolveActionScope(params.action);
  if (scope === "workflow") {
    return true;
  }
  return mode === "verbose" || mode === "full";
}

function buildWorkflowChannelPayload(params: {
  record: WorkflowExecutionRecord;
  action: WorkflowChannelForwardAction;
  target?: { channel?: string | null };
}) {
  const scope = resolveActionScope(params.action);
  const title =
    normalizeOptionalString(params.action.projectedTitle) ??
    normalizeOptionalString(params.action.title) ??
    "Workflow update";
  const summary =
    normalizeOptionalString(params.action.projectedSummary) ??
    normalizeOptionalString(params.action.summary);
  const channel = normalizeMessageChannel(params.target?.channel) ?? params.target?.channel;
  const footerParts = [
    `Status: ${params.action.status}`,
    scope === "workflow" ? "Workflow" : scope === "compensation" ? "Compensation" : "Step",
    `Execution: ${params.record.executionId}`,
    normalizeOptionalString(params.action.detail?.stepId),
  ].filter(Boolean);
  const footer = footerParts.join(" · ");
  const commands = buildWorkflowChannelControlCommands(params.record.executionId);
  const resumeCallbackData =
    channel === "discord" && params.action.status === "waiting"
      ? buildWorkflowDiscordResumeCallbackData({
          executionId: params.record.executionId,
          workspaceDir: params.record.originWorkspaceDir,
          agentDir: params.record.originAgentDir,
        })
      : undefined;
  if (resumeCallbackData) {
    ensureWorkflowInteractiveHandlersRegistered();
  }
  return buildWorkflowReplyPayload({
    channel,
    title,
    summary,
    footer,
    workflow: {
      version: 1,
      actionId: params.action.actionId,
      ...(params.action.parentActionId ? { parentActionId: params.action.parentActionId } : {}),
      executionId: params.record.executionId,
      workflowId: params.record.workflowId,
      ...(params.record.workflowName ? { workflowName: params.record.workflowName } : {}),
      status: params.action.status,
      scope,
      visibilityMode: resolveForwardMode(params.record),
      ...(normalizeOptionalString(params.record.originSessionKey)
        ? { sessionKey: normalizeOptionalString(params.record.originSessionKey) }
        : {}),
      ...(normalizeOptionalString(params.action.detail?.stepId)
        ? { stepId: normalizeOptionalString(params.action.detail?.stepId) }
        : {}),
    },
    refreshCommand: commands?.refreshCommand,
    cancelCommand: commands?.cancelCommand,
    resumeCommand: commands?.resumeCommand,
    resumeCallbackData,
  });
}

function defaultResolveSessionTarget(params: {
  cfg: CrawClawConfig;
  record: WorkflowExecutionRecord;
}): WorkflowChannelForwardTarget | null {
  const sessionKey = normalizeOptionalString(params.record.originSessionKey);
  if (!sessionKey) {
    return null;
  }
  return resolveExecApprovalSessionTarget({
    cfg: params.cfg,
    request: {
      id: `workflow:${params.record.executionId}`,
      request: {
        command: "workflow",
        sessionKey,
        ...(normalizeOptionalString(params.record.originAgentId)
          ? { agentId: normalizeOptionalString(params.record.originAgentId) }
          : {}),
      },
      createdAtMs: 0,
      expiresAtMs: 0,
    },
  });
}

export async function forwardWorkflowActionToChannel(
  params: {
    record: WorkflowExecutionRecord;
    action: WorkflowChannelForwardAction;
  },
  deps: WorkflowChannelForwarderDeps = {},
): Promise<boolean> {
  if (!shouldForwardAction(params)) {
    return false;
  }

  const cfg = deps.getConfig?.() ?? loadConfig();
  const rawTarget = (deps.resolveSessionTarget ?? defaultResolveSessionTarget)({
    cfg,
    record: params.record,
  });
  const deliverableTarget = resolveDeliverableTarget(rawTarget);
  if (!rawTarget || !deliverableTarget) {
    return false;
  }
  const target = { ...rawTarget, ...deliverableTarget };

  try {
    await (deps.deliver ?? deliverOutboundPayloads)({
      cfg,
      channel: target.channel,
      to: target.to,
      accountId: target.accountId,
      threadId: target.threadId,
      payloads: [buildWorkflowChannelPayload({ ...params, target })],
      bestEffort: true,
    });
    return true;
  } catch (error) {
    log.warn(`workflow channel forward failed: ${String(error)}`, {
      executionId: params.record.executionId,
      workflowId: params.record.workflowId,
      actionId: params.action.actionId,
      status: params.action.status,
      channel: target.channel,
      to: target.to,
    });
    return false;
  }
}

export const __testing = {
  buildWorkflowChannelPayload,
  resolveActionScope,
  resolveForwardMode,
  shouldForwardAction,
};
