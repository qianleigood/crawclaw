import type { PluginRuntime, SubagentRunParams } from "../plugins/runtime/types.js";
import {
  normalizeWorkflowAgentNodeRequest,
  type WorkflowAgentNodeResult,
  type WorkflowAgentNodeRequest,
} from "../workflows/api.js";

function normalizeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "step";
}

export function buildWorkflowStepAgentSessionKey(request: WorkflowAgentNodeRequest): string {
  if (request.sessionBinding?.sessionKey?.trim()) {
    return request.sessionBinding.sessionKey.trim();
  }
  const normalized = normalizeWorkflowAgentNodeRequest(request);
  return [
    "agent:workflow",
    normalizeSegment(normalized.workflowId),
    normalizeSegment(normalized.executionId),
    normalizeSegment(normalized.stepId),
  ].join(":");
}

export function buildWorkflowStepAgentSystemPrompt(request: WorkflowAgentNodeRequest): string {
  const normalized = normalizeWorkflowAgentNodeRequest(request);
  const tools = normalized.allowedTools?.length
    ? normalized.allowedTools.join(", ")
    : "(use only when strictly necessary)";
  const skills = normalized.allowedSkills?.length
    ? normalized.allowedSkills.join(", ")
    : "(none explicitly allowed)";
  const resultSchema = normalized.resultSchema
    ? JSON.stringify(normalized.resultSchema, null, 2)
    : JSON.stringify(
        {
          type: "object",
          required: ["status", "summary"],
          properties: {
            status: {
              type: "string",
              enum: ["succeeded", "failed", "waiting_input", "waiting_external", "cancelled"],
            },
            summary: { type: "string" },
            output: { type: "object" },
            artifacts: { type: "array" },
            error: { type: "string" },
          },
        },
        null,
        2,
      );

  return [
    "You are the CrawClaw workflow-step-agent.",
    "Execute exactly one workflow step and return a single structured JSON object.",
    `Workflow: ${normalized.workflowId}`,
    `Execution: ${normalized.executionId}`,
    ...(normalized.topology ? [`Topology: ${normalized.topology}`] : []),
    `Step: ${normalized.stepId}`,
    ...(normalized.stepPath ? [`Path: ${normalized.stepPath}`] : []),
    ...(normalized.branchGroup ? [`Branch group: ${normalized.branchGroup}`] : []),
    ...(normalized.activation?.mode ? [`Activation mode: ${normalized.activation.mode}`] : []),
    ...(normalized.activation?.when ? [`Activation condition: ${normalized.activation.when}`] : []),
    ...(normalized.activation?.fromStepIds?.length
      ? [`Activation sources: ${normalized.activation.fromStepIds.join(", ")}`]
      : []),
    ...(normalized.terminalOnSuccess ? ["Terminal on success: true"] : []),
    `Allowed tools: ${tools}`,
    `Allowed skills: ${skills}`,
    `Max steps: ${normalized.maxSteps ?? 8}`,
    `Timeout: ${normalized.timeoutMs ?? 300000}ms`,
    "Do not continue the broader conversation.",
    "Do not emit prose outside the JSON result.",
    "If user input or external approval is required, return waiting_input or waiting_external.",
    `Result schema:\n${resultSchema}`,
  ].join("\n");
}

export function buildWorkflowStepAgentMessage(request: WorkflowAgentNodeRequest): string {
  const normalized = normalizeWorkflowAgentNodeRequest(request);
  const payload = {
    goal: normalized.goal,
    inputs: normalized.inputs ?? {},
  };
  return [
    `Execute workflow step "${normalized.stepId}".`,
    `Goal: ${normalized.goal}`,
    "Inputs:",
    JSON.stringify(payload.inputs, null, 2),
  ].join("\n");
}

export function buildWorkflowStepAgentRunParams(
  request: WorkflowAgentNodeRequest,
): SubagentRunParams {
  const normalized = normalizeWorkflowAgentNodeRequest(request);
  return {
    sessionKey: buildWorkflowStepAgentSessionKey(normalized),
    message: buildWorkflowStepAgentMessage(normalized),
    ...(normalized.allowedTools?.length ? { toolsAllow: [...normalized.allowedTools] } : {}),
    ...(normalized.allowedSkills?.length ? { skillsAllow: [...normalized.allowedSkills] } : {}),
    extraSystemPrompt: buildWorkflowStepAgentSystemPrompt(normalized),
    lane: "workflow-step",
    deliver: false,
    idempotencyKey: [
      "workflow-step",
      normalized.workflowId,
      normalized.executionId,
      normalized.stepId,
    ].join(":"),
  };
}

export function buildWorkflowStepCompensationRequest(
  request: WorkflowAgentNodeRequest,
  params?: {
    summary?: string;
    error?: string;
  },
): WorkflowAgentNodeRequest | null {
  const normalized = normalizeWorkflowAgentNodeRequest(request);
  if (!normalized.compensation || normalized.compensation.mode !== "crawclaw_agent") {
    return null;
  }
  const compensationGoal =
    normalized.compensation.goal?.trim() ||
    `Compensate for failed workflow step "${normalized.stepId}".`;
  const failureContext =
    params?.summary || params?.error
      ? {
          failedStep: {
            stepId: normalized.stepId,
            ...(params?.summary ? { summary: params.summary } : {}),
            ...(params?.error ? { error: params.error } : {}),
          },
        }
      : {};
  return normalizeWorkflowAgentNodeRequest({
    ...normalized,
    stepId: `${normalized.stepId}__compensation`,
    goal: compensationGoal,
    inputs: {
      ...normalized.inputs,
      ...failureContext,
    },
    allowedTools: normalized.compensation.allowedTools ?? normalized.allowedTools,
    allowedSkills: normalized.compensation.allowedSkills ?? normalized.allowedSkills,
    timeoutMs:
      normalized.compensation.timeoutMs ?? Math.min(normalized.timeoutMs ?? 300_000, 120_000),
    maxSteps: normalized.compensation.maxSteps ?? 4,
    compensation: undefined,
    terminalOnSuccess: false,
  });
}

function extractTextFromUnknown(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTextFromUnknown(entry));
  }
  const record = value as Record<string, unknown>;
  const ownText = typeof record.text === "string" ? [record.text.trim()].filter(Boolean) : [];
  const nested = [
    ...extractTextFromUnknown(record.content),
    ...extractTextFromUnknown(record.message),
    ...extractTextFromUnknown(record.messages),
  ];
  return [...ownText, ...nested];
}

export function extractWorkflowStepAgentResult(
  messages: unknown[],
): WorkflowAgentNodeResult | null {
  const texts = messages.flatMap((message) => extractTextFromUnknown(message));
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const text = texts[index];
    if (!text.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(text) as WorkflowAgentNodeResult;
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.status === "string" &&
        ["succeeded", "failed", "waiting_input", "waiting_external", "cancelled"].includes(
          parsed.status,
        )
      ) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function runWorkflowStepAgent(
  subagent: PluginRuntime["subagent"],
  request: WorkflowAgentNodeRequest,
): Promise<{
  runId: string;
  sessionKey: string;
  waitStatus: "ok" | "error" | "timeout";
  messages: unknown[];
  result: WorkflowAgentNodeResult | null;
  waitError?: string;
}> {
  const normalized = normalizeWorkflowAgentNodeRequest(request);
  const runParams = buildWorkflowStepAgentRunParams(normalized);
  const run = await subagent.run(runParams);
  const waited = await subagent.waitForRun({
    runId: run.runId,
    timeoutMs: normalized.timeoutMs,
  });
  const messages =
    waited.status === "ok" || waited.status === "error"
      ? (
          await subagent.getSessionMessages({
            sessionKey: runParams.sessionKey,
            limit: 50,
          })
        ).messages
      : [];
  return {
    runId: run.runId,
    sessionKey: runParams.sessionKey,
    waitStatus: waited.status,
    ...(waited.error ? { waitError: waited.error } : {}),
    messages,
    result: extractWorkflowStepAgentResult(messages),
  };
}
