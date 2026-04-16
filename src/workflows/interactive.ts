import { loadConfig } from "../config/config.js";
import { registerPluginInteractiveHandler } from "../plugins/interactive.js";
import type { PluginInteractiveDiscordHandlerContext } from "../plugins/types.js";
import {
  requireWorkflowN8nRuntime,
  resumeWorkflowExecution,
  WorkflowOperationInputError,
  WorkflowOperationUnavailableError,
} from "./api.js";

type WorkflowInteractiveActionPayload = {
  action: "resume";
  executionId: string;
  workspaceDir?: string;
  agentDir?: string;
};

const WORKFLOW_INTERACTIVE_PLUGIN_ID = "builtin.workflow";
const WORKFLOW_INTERACTIVE_NAMESPACE = "workflow";

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function serializeWorkflowInteractiveActionPayload(
  payload: WorkflowInteractiveActionPayload,
): string {
  return `${payload.action}:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function parseWorkflowInteractiveActionPayload(
  payload: string,
): WorkflowInteractiveActionPayload | null {
  const separatorIndex = payload.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }
  const action = payload.slice(0, separatorIndex).trim();
  const encoded = payload.slice(separatorIndex + 1).trim();
  if (action !== "resume" || !encoded) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const executionId = normalizeOptionalString((parsed as { executionId?: unknown }).executionId);
    if (!executionId) {
      return null;
    }
    return {
      action: "resume",
      executionId,
      ...(normalizeOptionalString((parsed as { workspaceDir?: unknown }).workspaceDir)
        ? {
            workspaceDir: normalizeOptionalString(
              (parsed as { workspaceDir?: unknown }).workspaceDir,
            ),
          }
        : {}),
      ...(normalizeOptionalString((parsed as { agentDir?: unknown }).agentDir)
        ? { agentDir: normalizeOptionalString((parsed as { agentDir?: unknown }).agentDir) }
        : {}),
    };
  } catch {
    return null;
  }
}

function buildWorkflowResumeReplyText(params: {
  workflowName?: string;
  workflowId?: string;
  executionId: string;
  currentStepId?: string;
}): string {
  const label =
    normalizeOptionalString(params.workflowName) ??
    normalizeOptionalString(params.workflowId) ??
    params.executionId;
  const lines = [`Workflow resume requested: ${label}`, `Execution: ${params.executionId}`];
  if (normalizeOptionalString(params.currentStepId)) {
    lines.push(`Current step: ${normalizeOptionalString(params.currentStepId)}`);
  }
  return lines.join("\n");
}

function extractWorkflowResumeInput(
  fields: PluginInteractiveDiscordHandlerContext["interaction"]["fields"],
): string | undefined {
  const field = fields?.find((entry) => entry.name === "input") ?? fields?.[0];
  const value = field?.values?.find((entry) => entry.trim())?.trim();
  return value || undefined;
}

export async function handleWorkflowDiscordInteractive(
  ctx: PluginInteractiveDiscordHandlerContext,
): Promise<{ handled: boolean }> {
  if (!ctx.auth.isAuthorizedSender) {
    await ctx.respond.reply({
      text: "You are not authorized to control this workflow.",
      ephemeral: true,
    });
    return { handled: true };
  }

  const parsed = parseWorkflowInteractiveActionPayload(ctx.interaction.payload);
  if (!parsed) {
    await ctx.respond.reply({
      text: "This workflow control is no longer valid.",
      ephemeral: true,
    });
    return { handled: true };
  }

  try {
    const cfg = loadConfig();
    const { client, resolved } = requireWorkflowN8nRuntime(cfg);
    const resumed = await resumeWorkflowExecution({
      context: {
        workspaceDir: parsed.workspaceDir,
        agentDir: parsed.agentDir,
      },
      client,
      n8nBaseUrl: resolved.baseUrl,
      executionId: parsed.executionId,
      input: extractWorkflowResumeInput(ctx.interaction.fields),
      actorLabel: "discord workflow control",
    });
    const replyText = buildWorkflowResumeReplyText({
      workflowName: resumed.execution.workflowName,
      workflowId: resumed.execution.workflowId,
      executionId: resumed.execution.executionId,
      currentStepId: resumed.execution.currentStepId,
    });
    await ctx.respond.clearComponents({
      text: replyText,
    });
    await ctx.respond.followUp({
      text: replyText,
      ephemeral: true,
    });
    return { handled: true };
  } catch (error) {
    if (
      error instanceof WorkflowOperationInputError ||
      error instanceof WorkflowOperationUnavailableError
    ) {
      await ctx.respond.reply({
        text: error.message,
        ephemeral: true,
      });
      return { handled: true };
    }
    throw error;
  }
}

export function buildWorkflowDiscordResumeCallbackData(params: {
  executionId?: string;
  workspaceDir?: string;
  agentDir?: string;
}): string | undefined {
  const executionId = normalizeOptionalString(params.executionId);
  if (!executionId) {
    return undefined;
  }
  const payload = serializeWorkflowInteractiveActionPayload({
    action: "resume",
    executionId,
    ...(normalizeOptionalString(params.workspaceDir)
      ? { workspaceDir: normalizeOptionalString(params.workspaceDir) }
      : {}),
    ...(normalizeOptionalString(params.agentDir)
      ? { agentDir: normalizeOptionalString(params.agentDir) }
      : {}),
  });
  return `${WORKFLOW_INTERACTIVE_NAMESPACE}:${payload}`;
}

export function ensureWorkflowInteractiveHandlersRegistered(): void {
  const result = registerPluginInteractiveHandler(WORKFLOW_INTERACTIVE_PLUGIN_ID, {
    channel: "discord",
    namespace: WORKFLOW_INTERACTIVE_NAMESPACE,
    handler: handleWorkflowDiscordInteractive,
  });
  if (result.ok) {
    return;
  }
  if (result.error?.includes(`namespace "${WORKFLOW_INTERACTIVE_NAMESPACE}" already registered`)) {
    return;
  }
}

export const __testing = {
  buildWorkflowResumeReplyText,
  extractWorkflowResumeInput,
  parseWorkflowInteractiveActionPayload,
  serializeWorkflowInteractiveActionPayload,
};
