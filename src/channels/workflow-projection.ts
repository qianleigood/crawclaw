import type { ReplyPayload } from "../auto-reply/types.js";
import { createInfoCard } from "../plugin-sdk/line.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";
import {
  buildWorkflowDiscordComponents,
  buildWorkflowTelegramButtons,
} from "./workflow-controls.js";

type WorkflowProjectionScope = "workflow" | "step" | "compensation";

export type WorkflowTelegramButtons = ReadonlyArray<
  ReadonlyArray<{
    text: string;
    callback_data: string;
    style?: "danger" | "success" | "primary";
  }>
>;

export type WorkflowDiscordComponents = {
  blocks: Array<Record<string, unknown>>;
  modal?: Record<string, unknown>;
};

export type WorkflowProjectionMetadata = {
  version: 1;
  actionId: string;
  parentActionId?: string;
  executionId: string;
  workflowId: string;
  workflowName?: string;
  status: string;
  scope: WorkflowProjectionScope;
  visibilityMode: string;
  sessionKey?: string;
  stepId?: string;
};

export function buildWorkflowControlChannelData(params: {
  channel?: string | null;
  workflow: Pick<WorkflowProjectionMetadata, "scope" | "status">;
  refreshCommand?: string;
  cancelCommand?: string;
  resumeCommand?: string;
  resumeCallbackData?: string;
}): Record<string, unknown> | undefined {
  const channel = normalizeMessageChannel(params.channel) ?? params.channel;
  if (channel === "telegram") {
    const buttons = buildWorkflowTelegramButtons({
      scope: params.workflow.scope,
      status: params.workflow.status,
      refreshCommand: params.refreshCommand,
      cancelCommand: params.cancelCommand,
      resumeCommand: params.resumeCommand,
    });
    return buttons ? { telegram: { buttons } } : undefined;
  }
  if (channel === "discord") {
    const components = buildWorkflowDiscordComponents({
      scope: params.workflow.scope,
      status: params.workflow.status,
      refreshCommand: params.refreshCommand,
      cancelCommand: params.cancelCommand,
      resumeCallbackData: params.resumeCallbackData,
    });
    return components ? { discord: { components } } : undefined;
  }
  return undefined;
}

export function buildWorkflowReplyPayload(params: {
  channel?: string | null;
  title: string;
  summary?: string;
  footer: string;
  workflow: WorkflowProjectionMetadata;
  refreshCommand?: string;
  cancelCommand?: string;
  resumeCommand?: string;
  resumeCallbackData?: string;
}): ReplyPayload {
  const title = normalizeOptionalString(params.title) ?? "Workflow update";
  const summary = normalizeOptionalString(params.summary);
  const lines = summary && summary !== title ? [title, summary] : [title];
  const channel = normalizeMessageChannel(params.channel) ?? params.channel;

  return {
    text: lines.join("\n"),
    channelData: {
      workflow: {
        ...params.workflow,
      },
      ...buildWorkflowControlChannelData({
        channel,
        workflow: params.workflow,
        refreshCommand: params.refreshCommand,
        cancelCommand: params.cancelCommand,
        resumeCommand: params.resumeCommand,
        resumeCallbackData: params.resumeCallbackData,
      }),
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
                      text: params.footer,
                    },
                  ],
                },
              ],
            },
          }
        : {}),
      ...(channel === "line"
        ? {
            line: {
              flexMessage: {
                altText: title,
                contents: createInfoCard(
                  title,
                  summary ?? `Status: ${params.workflow.status}`,
                  params.footer,
                ),
              },
            },
          }
        : {}),
    },
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
