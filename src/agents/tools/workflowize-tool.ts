import { Type } from "@sinclair/typebox";
import { createWorkflowDraft } from "../../workflows/api.js";
import { stringEnum } from "../schema/typebox.js";
import {
  jsonResult,
  readStringArrayParam,
  readStringParam,
  ToolInputError,
  type AnyAgentTool,
} from "./common.js";

const WorkflowStepKinds = ["native", "service", "crawclaw_agent", "human_wait"] as const;
const WorkflowHttpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const WorkflowTopologies = ["linear_v1", "branch_v2"] as const;
const WorkflowActivationModes = ["sequential", "conditional", "fan_out", "fan_in"] as const;
const WorkflowFanOutFailurePolicies = ["fail_fast", "continue"] as const;
const WorkflowFanOutJoinPolicies = ["all", "best_effort"] as const;
const WorkflowCompensationModes = ["none", "crawclaw_agent"] as const;

const WorkflowizeStepSchema = Type.Object({
  title: Type.String(),
  goal: Type.Optional(Type.String()),
  kind: Type.Optional(stringEnum(WorkflowStepKinds)),
  skill: Type.Optional(Type.String()),
  prompt: Type.Optional(Type.String()),
  service: Type.Optional(Type.String()),
  serviceUrl: Type.Optional(Type.String()),
  serviceMethod: Type.Optional(stringEnum(WorkflowHttpMethods)),
  allowedTools: Type.Optional(Type.Array(Type.String())),
  allowedSkills: Type.Optional(Type.Array(Type.String())),
  waitKind: Type.Optional(stringEnum(["input", "external"] as const)),
  notes: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  branchGroup: Type.Optional(Type.String()),
  activationMode: Type.Optional(stringEnum(WorkflowActivationModes)),
  activationWhen: Type.Optional(Type.String()),
  activationFromStepIds: Type.Optional(Type.Array(Type.String())),
  parallelFailurePolicy: Type.Optional(stringEnum(WorkflowFanOutFailurePolicies)),
  parallelJoinPolicy: Type.Optional(stringEnum(WorkflowFanOutJoinPolicies)),
  maxActiveBranches: Type.Optional(Type.Number()),
  retryOnFail: Type.Optional(Type.Boolean()),
  maxTries: Type.Optional(Type.Number()),
  waitBetweenTriesMs: Type.Optional(Type.Number()),
  compensationMode: Type.Optional(stringEnum(WorkflowCompensationModes)),
  compensationGoal: Type.Optional(Type.String()),
  compensationAllowedTools: Type.Optional(Type.Array(Type.String())),
  compensationAllowedSkills: Type.Optional(Type.Array(Type.String())),
  compensationTimeoutMs: Type.Optional(Type.Number()),
  compensationMaxSteps: Type.Optional(Type.Number()),
  terminalOnSuccess: Type.Optional(Type.Boolean()),
});

const WorkflowizeToolSchema = Type.Object({
  name: Type.String({
    description: "Stable workflow name used for later lookup and execution.",
  }),
  goal: Type.String({
    description: "The high-level goal the workflow should accomplish.",
  }),
  topology: Type.Optional(
    stringEnum(WorkflowTopologies, {
      description:
        "Workflow topology. Omit for auto-detection. Use branch_v2 when the workflow contains conditional branches or joins.",
    }),
  ),
  description: Type.Optional(
    Type.String({
      description: "Optional human-readable description of what the workflow does.",
    }),
  ),
  sourceSummary: Type.Optional(
    Type.String({
      description: "Optional summary of the successful CrawClaw run that is being distilled.",
    }),
  ),
  steps: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional ordered step titles for the first draft spec.",
    }),
  ),
  stepSpecs: Type.Optional(
    Type.Array(WorkflowizeStepSchema, {
      description:
        "Optional structured workflow step definitions. Prefer this over steps when step kind, source skill, or service callback details matter.",
    }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional tags for future lookup and workflow matching.",
    }),
  ),
  inputs: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional input field names for the draft workflow.",
    }),
  ),
  outputs: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional output field names for the draft workflow.",
    }),
  ),
  safeForAutoRun: Type.Optional(Type.Boolean()),
  requiresApproval: Type.Optional(Type.Boolean()),
});

export function createWorkflowizeTool(opts?: {
  workspaceDir?: string;
  agentDir?: string;
  sessionKey?: string;
  sessionId?: string;
}): AnyAgentTool {
  return {
    label: "Workflowize",
    name: "workflowize",
    description:
      "Turn a successful task into a draft workflow spec and local workflow registry entry for later n8n deployment.",
    parameters: WorkflowizeToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const name = readStringParam(params, "name", { required: true });
      const goal = readStringParam(params, "goal", { required: true });
      const topology = readStringParam(params, "topology") as "linear_v1" | "branch_v2" | undefined;
      const description = readStringParam(params, "description");
      const sourceSummary = readStringParam(params, "sourceSummary");
      const steps = readStringArrayParam(params, "steps");
      const stepSpecs = Array.isArray(params.stepSpecs)
        ? params.stepSpecs
            .filter(
              (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object",
            )
            .map((entry) => ({
              title: readStringParam(entry, "title", { required: true }),
              goal: readStringParam(entry, "goal"),
              kind: readStringParam(entry, "kind") as
                | "native"
                | "service"
                | "crawclaw_agent"
                | "human_wait"
                | undefined,
              skill: readStringParam(entry, "skill"),
              prompt: readStringParam(entry, "prompt"),
              service: readStringParam(entry, "service"),
              serviceUrl: readStringParam(entry, "serviceUrl"),
              serviceMethod: readStringParam(entry, "serviceMethod") as
                | "GET"
                | "POST"
                | "PUT"
                | "PATCH"
                | "DELETE"
                | "HEAD"
                | "OPTIONS"
                | undefined,
              allowedTools: readStringArrayParam(entry, "allowedTools"),
              allowedSkills: readStringArrayParam(entry, "allowedSkills"),
              waitKind: readStringParam(entry, "waitKind") as "input" | "external" | undefined,
              notes: readStringParam(entry, "notes"),
              path: readStringParam(entry, "path"),
              branchGroup: readStringParam(entry, "branchGroup"),
              activationMode: readStringParam(entry, "activationMode") as
                | "sequential"
                | "conditional"
                | "fan_out"
                | "fan_in"
                | undefined,
              activationWhen: readStringParam(entry, "activationWhen"),
              activationFromStepIds: readStringArrayParam(entry, "activationFromStepIds"),
              parallelFailurePolicy: readStringParam(entry, "parallelFailurePolicy") as
                | "fail_fast"
                | "continue"
                | undefined,
              parallelJoinPolicy: readStringParam(entry, "parallelJoinPolicy") as
                | "all"
                | "best_effort"
                | undefined,
              maxActiveBranches:
                typeof entry.maxActiveBranches === "number" ? entry.maxActiveBranches : undefined,
              retryOnFail: typeof entry.retryOnFail === "boolean" ? entry.retryOnFail : undefined,
              maxTries: typeof entry.maxTries === "number" ? entry.maxTries : undefined,
              waitBetweenTriesMs:
                typeof entry.waitBetweenTriesMs === "number" ? entry.waitBetweenTriesMs : undefined,
              compensationMode: readStringParam(entry, "compensationMode") as
                | "none"
                | "crawclaw_agent"
                | undefined,
              compensationGoal: readStringParam(entry, "compensationGoal"),
              compensationAllowedTools: readStringArrayParam(entry, "compensationAllowedTools"),
              compensationAllowedSkills: readStringArrayParam(entry, "compensationAllowedSkills"),
              compensationTimeoutMs:
                typeof entry.compensationTimeoutMs === "number"
                  ? entry.compensationTimeoutMs
                  : undefined,
              compensationMaxSteps:
                typeof entry.compensationMaxSteps === "number"
                  ? entry.compensationMaxSteps
                  : undefined,
              terminalOnSuccess:
                typeof entry.terminalOnSuccess === "boolean" ? entry.terminalOnSuccess : undefined,
            }))
        : undefined;
      const tags = readStringArrayParam(params, "tags");
      const inputs = readStringArrayParam(params, "inputs");
      const outputs = readStringArrayParam(params, "outputs");
      const safeForAutoRun =
        typeof params.safeForAutoRun === "boolean" ? params.safeForAutoRun : undefined;
      const requiresApproval =
        typeof params.requiresApproval === "boolean" ? params.requiresApproval : undefined;

      try {
        const created = await createWorkflowDraft({
          workspaceDir: opts?.workspaceDir,
          agentDir: opts?.agentDir,
          name,
          goal,
          topology,
          description,
          sourceSummary,
          steps,
          stepSpecs,
          tags,
          inputs,
          outputs,
          safeForAutoRun,
          requiresApproval,
          sessionKey: opts?.sessionKey,
          sessionId: opts?.sessionId,
        });
        return jsonResult({
          status: "created",
          workflowId: created.entry.workflowId,
          name: created.entry.name,
          deploymentState: created.entry.deploymentState,
          target: created.entry.target,
          storeRoot: created.storeRoot,
          specPath: created.specPath,
          workflow: created.entry,
          spec: created.spec,
        });
      } catch (error) {
        throw new ToolInputError(
          error instanceof Error ? error.message : "Failed to workflowize task.",
        );
      }
    },
  };
}
