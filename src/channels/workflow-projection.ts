import type { ReplyPayload } from "../auto-reply/types.js";

type WorkflowProjectionScope = "workflow" | "step" | "compensation";

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

export function buildWorkflowControlChannelData(_params: {
  channel?: string | null;
  workflow: Pick<WorkflowProjectionMetadata, "scope" | "status">;
  refreshCommand?: string;
  cancelCommand?: string;
  resumeCommand?: string;
  resumeCallbackData?: string;
}): Record<string, unknown> | undefined {
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

  return {
    text: lines.join("\n"),
    channelData: {
      workflow: {
        ...params.workflow,
      },
    },
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
