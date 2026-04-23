import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { executeWorkflowToolAction, type WorkflowToolOptions } from "./workflow-tool-runner.js";

const WORKFLOW_ACTIONS = [
  "list",
  "describe",
  "match",
  "versions",
  "diff",
  "update",
  "republish",
  "rollback",
  "runs",
  "deploy",
  "enable",
  "disable",
  "archive",
  "unarchive",
  "delete",
  "run",
  "status",
  "cancel",
  "resume",
] as const;

const WorkflowToolSchema = Type.Object({
  action: stringEnum(WORKFLOW_ACTIONS, {
    description: "Workflow action to perform.",
  }),
  workflow: Type.Optional(
    Type.String({
      description: "Workflow id or workflow name for describe/enable/disable/run.",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description: "Search query for workflow matching.",
    }),
  ),
  enabledOnly: Type.Optional(Type.Boolean()),
  deployedOnly: Type.Optional(Type.Boolean()),
  autoRunnableOnly: Type.Optional(Type.Boolean()),
  limit: Type.Optional(Type.Number({ minimum: 1 })),
  executionId: Type.Optional(
    Type.String({
      description: "Execution id for status/cancel once n8n integration lands.",
    }),
  ),
  input: Type.Optional(
    Type.String({
      description:
        "Optional operator input for resuming a waiting workflow. JSON strings are parsed as payload objects; plain text is sent as { input }.",
    }),
  ),
  inputs: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description:
        "Optional structured workflow input payload for action=run. These values are passed to n8n as workflowInput and also mirrored at the top level for backward compatibility.",
    }),
  ),
  approved: Type.Optional(
    Type.Boolean({
      description:
        "For action=run, confirms an upstream explicit user approval for workflows that require approval.",
    }),
  ),
  patch: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description:
        "Partial workflow definition patch for action=update. Supports top-level fields like name, goal, description, tags, inputs, outputs, topology, steps, safeForAutoRun, and requiresApproval.",
    }),
  ),
  specVersion: Type.Optional(
    Type.Number({
      minimum: 1,
      description:
        "Workflow spec version for action=diff or action=rollback. For diff, this is the baseline spec version.",
    }),
  ),
  toSpecVersion: Type.Optional(
    Type.Number({
      minimum: 1,
      description:
        "Target workflow spec version for action=diff. Defaults to the current spec version.",
    }),
  ),
  republish: Type.Optional(
    Type.Boolean({
      description:
        "For action=rollback, republish the rolled-back spec to n8n after updating local state.",
    }),
  ),
  summary: Type.Optional(
    Type.String({
      description: "Optional operator summary for action=republish or action=rollback.",
    }),
  ),
});

export function createWorkflowTool(opts?: {
  workspaceDir?: string;
  agentDir?: string;
  sessionKey?: string;
  sessionId?: string;
  config?: import("../../config/config.js").CrawClawConfig;
}): AnyAgentTool {
  const options: WorkflowToolOptions | undefined = opts;
  return {
    label: "Workflow",
    name: "workflow",
    description:
      "List, inspect, match, deploy, and manage workflow registry entries. Prefer action=match before repeating a task that may already exist as a workflow, then follow invocation.recommendedAction to run directly or ask the user. n8n-backed deploy/run/status/cancel require workflow.n8n config or CRAWCLAW_N8N_* env vars.",
    parameters: WorkflowToolSchema,
    execute: async (toolCallId, args) =>
      await executeWorkflowToolAction(options, toolCallId, args as Record<string, unknown>),
  };
}
