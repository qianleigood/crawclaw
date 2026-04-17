import { buildWorkflowControlChannelData } from "../../channels/workflow-projection.js";
import {
  WorkflowOperationInputError,
  WorkflowOperationUnavailableError,
} from "../../workflows/api.js";
import {
  buildWorkflowChannelControlCommands,
  buildWorkflowResumeCommandTemplate,
} from "../../workflows/channel-controls.js";
import {
  executeWorkflowControlAction,
  resolveWorkflowControlContext,
} from "../../workflows/control-runtime.js";
import {
  buildWorkflowDiscordResumeCallbackData,
  ensureWorkflowInteractiveHandlersRegistered,
} from "../../workflows/interactive.js";
import type { WorkflowExecutionView } from "../../workflows/types.js";
import type { CommandHandler } from "./commands-types.js";

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildWorkflowStatusTitle(execution: WorkflowExecutionView): string {
  const label = execution.workflowName?.trim() || execution.workflowId || execution.executionId;
  switch (execution.status) {
    case "queued":
      return `Queued workflow: ${label}`;
    case "running":
      return `Running workflow: ${label}`;
    case "waiting_input":
    case "waiting_external":
      return `Workflow waiting: ${label}`;
    case "succeeded":
      return `Workflow completed: ${label}`;
    case "failed":
      return `Workflow failed: ${label}`;
    case "cancelled":
      return `Workflow cancelled: ${label}`;
  }
  return `Workflow: ${label}`;
}

function buildWorkflowReplyText(params: {
  action: "status" | "cancel" | "resume";
  execution: WorkflowExecutionView;
  errorMessage?: string;
  resumeAccepted?: boolean;
}): string {
  const lines = [
    params.action === "resume" && params.resumeAccepted
      ? `Workflow resume requested: ${params.execution.workflowName?.trim() || params.execution.workflowId || params.execution.executionId}`
      : buildWorkflowStatusTitle(params.execution),
    `Execution: ${params.execution.executionId}`,
  ];
  if (normalizeOptionalString(params.execution.n8nExecutionId)) {
    lines.push(`Remote execution: ${normalizeOptionalString(params.execution.n8nExecutionId)}`);
  }
  if (normalizeOptionalString(params.execution.currentStepId)) {
    lines.push(`Current step: ${normalizeOptionalString(params.execution.currentStepId)}`);
  }
  if (normalizeOptionalString(params.execution.currentExecutor)) {
    lines.push(`Executor: ${normalizeOptionalString(params.execution.currentExecutor)}`);
  }
  if (normalizeOptionalString(params.execution.waiting?.prompt)) {
    lines.push(`Waiting: ${normalizeOptionalString(params.execution.waiting?.prompt)}`);
  }
  if (params.execution.waiting?.canResume) {
    lines.push(`Resume: ${buildWorkflowResumeCommandTemplate(params.execution.executionId)}`);
  } else if (
    params.execution.status === "waiting_input" ||
    params.execution.status === "waiting_external"
  ) {
    lines.push(
      "Resume unavailable yet. Refresh status after the Wait node persists execution state.",
    );
  }
  if (
    normalizeOptionalString(params.execution.remoteStatus) &&
    normalizeOptionalString(params.execution.remoteStatus)?.toLowerCase() !==
      params.execution.status
  ) {
    lines.push(`Remote status: ${normalizeOptionalString(params.execution.remoteStatus)}`);
  }
  const failedStep = params.execution.steps?.find((step) => step.status === "failed");
  const errorMessage =
    normalizeOptionalString(failedStep?.error) ?? normalizeOptionalString(params.errorMessage);
  if (errorMessage) {
    lines.push(`Error: ${errorMessage}`);
  }
  return lines.join("\n");
}

function buildWorkflowReplyChannelData(params: {
  surface?: string | null;
  execution: WorkflowExecutionView;
  workspaceDir?: string;
  agentDir?: string;
}): Record<string, unknown> | undefined {
  const surface = normalizeOptionalString(params.surface)?.toLowerCase();
  const commands = buildWorkflowChannelControlCommands(params.execution.executionId);
  const resumeCallbackData =
    surface === "discord" &&
    (params.execution.status === "waiting_input" || params.execution.status === "waiting_external")
      ? buildWorkflowDiscordResumeCallbackData({
          executionId: params.execution.executionId,
          workspaceDir: params.workspaceDir,
          agentDir: params.agentDir,
        })
      : undefined;
  if (resumeCallbackData) {
    ensureWorkflowInteractiveHandlersRegistered();
  }
  return buildWorkflowControlChannelData({
    channel: surface,
    workflow: {
      scope: "workflow",
      status: params.execution.status,
    },
    refreshCommand: commands?.refreshCommand,
    cancelCommand: commands?.cancelCommand,
    resumeCommand: commands?.resumeCommand,
    resumeCallbackData,
  });
}

function parseWorkflowCommand(
  commandBodyNormalized: string,
):
  | { action: "status" | "cancel"; executionId: string }
  | { action: "resume"; executionId: string; input?: string }
  | { usage: true }
  | null {
  const trimmed = commandBodyNormalized.trim();
  if (!trimmed.startsWith("/workflow")) {
    return null;
  }
  if (trimmed === "/workflow") {
    return { usage: true };
  }
  const match = trimmed.match(
    /^\/workflow\s+(status|cancel|resume)(?:\s+([^\s]+)(?:\s+([\s\S]+))?)?$/i,
  );
  if (!match) {
    return { usage: true };
  }
  const action = match[1]?.toLowerCase();
  const executionId = match[2]?.trim();
  const input = match[3]?.trim();
  if (!executionId) {
    return { usage: true };
  }
  if (action === "status" || action === "cancel") {
    return { action, executionId };
  }
  if (action === "resume") {
    return {
      action,
      executionId,
      ...(input ? { input } : {}),
    };
  }
  return { usage: true };
}

function workflowUsageText(): string {
  return [
    "Usage: /workflow <status|cancel|resume> <executionId> [input]",
    "Examples:",
    "  /workflow status exec_1234abcd",
    "  /workflow cancel exec_1234abcd",
    "  /workflow resume exec_1234abcd approved",
  ].join("\n");
}

export const handleWorkflowCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const parsed = parseWorkflowCommand(params.command.commandBodyNormalized);
  if (!parsed) {
    return null;
  }
  if ("usage" in parsed) {
    return { shouldContinue: false, reply: { text: workflowUsageText() } };
  }
  if (!params.command.isAuthorizedSender) {
    return { shouldContinue: false };
  }

  try {
    const context = resolveWorkflowControlContext({
      cfg: params.cfg,
      agentId: params.agentId,
      workspaceDir: params.workspaceDir,
      agentDir: params.agentDir,
    });
    if (parsed.action === "status") {
      const result = await executeWorkflowControlAction({
        action: "status",
        context,
        config: params.cfg,
        executionId: parsed.executionId,
      });
      return {
        shouldContinue: false,
        reply: {
          text: buildWorkflowReplyText({
            action: parsed.action,
            execution: result.execution,
            errorMessage: result.localExecution?.errorMessage,
          }),
          channelData: buildWorkflowReplyChannelData({
            surface: params.ctx.Surface ?? params.ctx.Provider,
            execution: result.execution,
            workspaceDir: params.workspaceDir,
            agentDir: params.agentDir,
          }),
        },
      };
    }

    if (parsed.action === "cancel") {
      const result = await executeWorkflowControlAction({
        action: "cancel",
        context,
        config: params.cfg,
        executionId: parsed.executionId,
      });
      return {
        shouldContinue: false,
        reply: {
          text: buildWorkflowReplyText({
            action: parsed.action,
            execution: result.execution,
            errorMessage: result.localExecution?.errorMessage,
          }),
          channelData: buildWorkflowReplyChannelData({
            surface: params.ctx.Surface ?? params.ctx.Provider,
            execution: result.execution,
            workspaceDir: params.workspaceDir,
            agentDir: params.agentDir,
          }),
        },
      };
    }

    const result = await executeWorkflowControlAction({
      action: "resume",
      context,
      config: params.cfg,
      executionId: parsed.executionId,
      input: parsed.action === "resume" ? parsed.input : undefined,
      actorLabel: "chat command",
    });
    return {
      shouldContinue: false,
      reply: {
        text: buildWorkflowReplyText({
          action: "resume",
          execution: result.execution,
          errorMessage: result.localExecution?.errorMessage,
          resumeAccepted: result.resumeAccepted,
        }),
        channelData: buildWorkflowReplyChannelData({
          surface: params.ctx.Surface ?? params.ctx.Provider,
          execution: result.execution,
          workspaceDir: params.workspaceDir,
          agentDir: params.agentDir,
        }),
      },
    };
  } catch (error) {
    if (
      error instanceof WorkflowOperationInputError ||
      error instanceof WorkflowOperationUnavailableError
    ) {
      return { shouldContinue: false, reply: { text: error.message } };
    }
    return {
      shouldContinue: false,
      reply: {
        text: `Workflow command failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
};
