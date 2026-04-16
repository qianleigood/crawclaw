import type { AgentActionStatus } from "../agents/action-feed/types.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { CrawClawConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import {
  resolveExecApprovalSessionTarget,
  type ExecApprovalSessionTarget,
} from "../infra/exec-approval-session-target.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { createInfoCard } from "../plugin-sdk/line.js";
import {
  isDeliverableMessageChannel,
  normalizeMessageChannel,
  type DeliverableMessageChannel,
} from "../utils/message-channel.js";
import {
  buildWorkflowDiscordComponents,
  buildWorkflowTelegramButtons,
} from "./channel-controls.js";
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
}): ReplyPayload {
  const scope = resolveActionScope(params.action);
  const title =
    normalizeOptionalString(params.action.projectedTitle) ??
    normalizeOptionalString(params.action.title) ??
    "Workflow update";
  const summary =
    normalizeOptionalString(params.action.projectedSummary) ??
    normalizeOptionalString(params.action.summary);
  const lines = summary && summary !== title ? [title, summary] : [title];
  const channel = normalizeMessageChannel(params.target?.channel) ?? params.target?.channel;
  const footerParts = [
    `Status: ${params.action.status}`,
    scope === "workflow" ? "Workflow" : scope === "compensation" ? "Compensation" : "Step",
    `Execution: ${params.record.executionId}`,
    normalizeOptionalString(params.action.detail?.stepId),
  ].filter(Boolean);
  const footer = footerParts.join(" · ");
  const workflowChannelData: Record<string, unknown> = {
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
  };
  return {
    text: lines.join("\n"),
    channelData: {
      workflow: workflowChannelData,
      ...(channel === "slack"
        ? {
            slack: {
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `*${title}*`,
                  },
                },
                ...(summary
                  ? [
                      {
                        type: "section",
                        text: {
                          type: "mrkdwn",
                          text: summary,
                        },
                      },
                    ]
                  : []),
                {
                  type: "context",
                  elements: [
                    {
                      type: "mrkdwn",
                      text: footer,
                    },
                  ],
                },
              ],
            },
          }
        : {}),
      ...(channel === "telegram"
        ? (() => {
            const buttons = buildWorkflowTelegramButtons({
              executionId: params.record.executionId,
              status: params.action.status,
              scope,
            });
            return buttons ? { telegram: { buttons } } : {};
          })()
        : {}),
      ...(channel === "discord"
        ? (() => {
            const components = buildWorkflowDiscordComponents({
              executionId: params.record.executionId,
              status: params.action.status,
              scope,
              workspaceDir: params.record.originWorkspaceDir,
              agentDir: params.record.originAgentDir,
            });
            return components ? { discord: { components } } : {};
          })()
        : {}),
      ...(channel === "line"
        ? {
            line: {
              flexMessage: {
                altText: title,
                contents: createInfoCard(
                  title,
                  summary ?? `Status: ${params.action.status}`,
                  footer,
                ),
              },
            },
          }
        : {}),
    },
  };
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

function resolveDeliverableTarget(
  target: WorkflowChannelForwardTarget | null,
): (WorkflowChannelForwardTarget & { channel: DeliverableMessageChannel }) | null {
  const channel = normalizeMessageChannel(target?.channel) ?? target?.channel;
  if (!channel || !target?.to || !isDeliverableMessageChannel(channel)) {
    return null;
  }
  return {
    ...target,
    channel,
  };
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
  const target = resolveDeliverableTarget(
    (deps.resolveSessionTarget ?? defaultResolveSessionTarget)({
      cfg,
      record: params.record,
    }),
  );
  if (!target) {
    return false;
  }

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
