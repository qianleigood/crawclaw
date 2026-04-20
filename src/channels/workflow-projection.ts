import type { ReplyPayload } from "../auto-reply/types.js";
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
                contents: buildLineWorkflowInfoCard(
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

function buildLineWorkflowInfoCard(title: string, body: string, footer?: string) {
  const bubble = {
    type: "bubble",
    size: "mega",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "box",
              layout: "vertical",
              contents: [],
              width: "4px",
              backgroundColor: "#06C755",
              cornerRadius: "2px",
            },
            {
              type: "text",
              text: title,
              weight: "bold",
              size: "xl",
              color: "#111111",
              wrap: true,
              flex: 1,
              margin: "lg",
            },
          ],
        },
        {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: body,
              size: "md",
              color: "#444444",
              wrap: true,
              lineSpacing: "6px",
            },
          ],
          margin: "xl",
          paddingAll: "lg",
          backgroundColor: "#F8F9FA",
          cornerRadius: "lg",
        },
      ],
      paddingAll: "xl",
      backgroundColor: "#FFFFFF",
    },
  } as Record<string, unknown>;

  if (!footer) {
    return bubble;
  }

  return {
    ...bubble,
    footer: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "separator",
          color: "#EEEEEE",
        },
        {
          type: "text",
          text: footer,
          size: "sm",
          color: "#888888",
          wrap: true,
          margin: "lg",
        },
      ],
      paddingAll: "xl",
      backgroundColor: "#FFFFFF",
    },
  };
}
