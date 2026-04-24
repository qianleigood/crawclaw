import type { ObservationContext } from "../infra/observation/types.js";
import type {
  WorkflowCompensationMode,
  WorkflowFanOutFailurePolicy,
  WorkflowFanOutJoinPolicy,
  WorkflowSpec,
  WorkflowStepActivationSpec,
  WorkflowStepSpec,
  WorkflowTopology,
} from "./types.js";

export type WorkflowAgentNodeRequest = {
  workflowId: string;
  executionId: string;
  localExecutionId?: string;
  topology?: WorkflowTopology;
  stepId: string;
  stepPath?: string;
  branchGroup?: string;
  activation?: WorkflowStepActivationSpec;
  parallelFailurePolicy?: WorkflowFanOutFailurePolicy;
  parallelJoinPolicy?: WorkflowFanOutJoinPolicy;
  maxActiveBranches?: number;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTriesMs?: number;
  compensation?: {
    mode?: WorkflowCompensationMode;
    goal?: string;
    allowedTools?: string[];
    allowedSkills?: string[];
    timeoutMs?: number;
    maxSteps?: number;
  };
  terminalOnSuccess?: boolean;
  goal: string;
  inputs?: Record<string, unknown>;
  allowedTools?: readonly string[];
  allowedSkills?: readonly string[];
  timeoutMs?: number;
  maxSteps?: number;
  resultSchema?: Record<string, unknown>;
  workspaceBinding?: {
    workspaceDir?: string;
    agentDir?: string;
  };
  sessionBinding?: {
    sessionKey?: string;
    ownerSessionKey?: string;
    sessionId?: string;
  };
  observation?: ObservationContext;
};

export type WorkflowAgentNodeResult = {
  status: "succeeded" | "failed" | "waiting_input" | "waiting_external" | "cancelled";
  output?: unknown;
  artifacts?: Array<{
    name: string;
    path?: string;
    mimeType?: string;
    description?: string;
  }>;
  summary?: string;
  error?: string;
  observation?: ObservationContext;
};

function normalizeStringList(values: readonly string[] | undefined): string[] | undefined {
  const normalized = Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  );
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeActivationWhen(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    const unwrapped = trimmed.slice(2, -2).trim();
    return unwrapped || undefined;
  }
  return trimmed;
}

export function normalizeWorkflowAgentNodeRequest(
  request: WorkflowAgentNodeRequest,
): WorkflowAgentNodeRequest {
  const normalizedStepPath =
    typeof request.stepPath === "string" && request.stepPath.trim()
      ? request.stepPath.trim()
      : undefined;
  const normalizedBranchGroup =
    typeof request.branchGroup === "string" && request.branchGroup.trim()
      ? request.branchGroup.trim()
      : undefined;
  const normalizedActivationWhen = normalizeActivationWhen(request.activation?.when);
  const normalizedActivationFromStepIds = normalizeStringList(request.activation?.fromStepIds);
  return {
    ...request,
    workflowId: request.workflowId.trim(),
    executionId: request.executionId.trim(),
    ...(typeof request.topology === "string" && request.topology.trim()
      ? { topology: request.topology.trim() as WorkflowTopology }
      : {}),
    ...(typeof request.localExecutionId === "string" && request.localExecutionId.trim()
      ? { localExecutionId: request.localExecutionId.trim() }
      : {}),
    stepId: request.stepId.trim(),
    ...(normalizedStepPath ? { stepPath: normalizedStepPath } : {}),
    ...(normalizedBranchGroup ? { branchGroup: normalizedBranchGroup } : {}),
    ...(request.activation?.mode || normalizedActivationWhen || normalizedActivationFromStepIds
      ? {
          activation: {
            ...(request.activation?.mode ? { mode: request.activation.mode } : {}),
            ...(normalizedActivationWhen ? { when: normalizedActivationWhen } : {}),
            ...(normalizedActivationFromStepIds
              ? { fromStepIds: normalizedActivationFromStepIds }
              : {}),
            ...(request.activation?.parallel
              ? {
                  parallel: {
                    ...(request.activation.parallel.failurePolicy
                      ? { failurePolicy: request.activation.parallel.failurePolicy }
                      : {}),
                    ...(request.activation.parallel.joinPolicy
                      ? { joinPolicy: request.activation.parallel.joinPolicy }
                      : {}),
                    ...(typeof request.activation.parallel.maxActiveBranches === "number"
                      ? { maxActiveBranches: request.activation.parallel.maxActiveBranches }
                      : {}),
                    ...(typeof request.activation.parallel.retryOnFail === "boolean"
                      ? { retryOnFail: request.activation.parallel.retryOnFail }
                      : {}),
                    ...(typeof request.activation.parallel.maxTries === "number"
                      ? { maxTries: request.activation.parallel.maxTries }
                      : {}),
                    ...(typeof request.activation.parallel.waitBetweenTriesMs === "number"
                      ? { waitBetweenTriesMs: request.activation.parallel.waitBetweenTriesMs }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(request.parallelFailurePolicy
      ? { parallelFailurePolicy: request.parallelFailurePolicy }
      : {}),
    ...(request.parallelJoinPolicy ? { parallelJoinPolicy: request.parallelJoinPolicy } : {}),
    ...(typeof request.maxActiveBranches === "number"
      ? { maxActiveBranches: request.maxActiveBranches }
      : {}),
    ...(typeof request.retryOnFail === "boolean" ? { retryOnFail: request.retryOnFail } : {}),
    ...(typeof request.maxTries === "number" ? { maxTries: request.maxTries } : {}),
    ...(typeof request.waitBetweenTriesMs === "number"
      ? { waitBetweenTriesMs: request.waitBetweenTriesMs }
      : {}),
    ...(request.compensation
      ? {
          compensation: {
            ...(request.compensation.mode ? { mode: request.compensation.mode } : {}),
            ...(typeof request.compensation.goal === "string" && request.compensation.goal.trim()
              ? { goal: request.compensation.goal.trim() }
              : {}),
            ...(normalizeStringList(request.compensation.allowedTools)
              ? { allowedTools: normalizeStringList(request.compensation.allowedTools) }
              : {}),
            ...(normalizeStringList(request.compensation.allowedSkills)
              ? { allowedSkills: normalizeStringList(request.compensation.allowedSkills) }
              : {}),
            ...(typeof request.compensation.timeoutMs === "number"
              ? { timeoutMs: request.compensation.timeoutMs }
              : {}),
            ...(typeof request.compensation.maxSteps === "number"
              ? { maxSteps: request.compensation.maxSteps }
              : {}),
          },
        }
      : {}),
    ...(request.terminalOnSuccess ? { terminalOnSuccess: true } : {}),
    goal: request.goal.trim(),
    ...(normalizeStringList(request.allowedTools)
      ? { allowedTools: normalizeStringList(request.allowedTools) }
      : {}),
    ...(normalizeStringList(request.allowedSkills)
      ? { allowedSkills: normalizeStringList(request.allowedSkills) }
      : {}),
  };
}

export function createCrawClawAgentNodeDraftRequest(
  spec: WorkflowSpec,
  step: WorkflowStepSpec,
): WorkflowAgentNodeRequest {
  const allowedSkills = Array.from(
    new Set(
      [step.sourceSkill, ...(step.agent?.allowedSkills ?? [])]
        .map((value) => value?.trim() ?? "")
        .filter(Boolean),
    ),
  );
  return normalizeWorkflowAgentNodeRequest({
    workflowId: spec.workflowId,
    executionId: "$execution.id",
    localExecutionId: "$json.crawclawExecutionId",
    topology: spec.topology ?? "linear_v1",
    stepId: step.id,
    ...(step.path?.trim() ? { stepPath: step.path.trim() } : {}),
    ...(step.branchGroup?.trim() ? { branchGroup: step.branchGroup.trim() } : {}),
    ...(step.activation ? { activation: step.activation } : {}),
    ...(step.activation?.parallel?.failurePolicy
      ? { parallelFailurePolicy: step.activation.parallel.failurePolicy }
      : {}),
    ...(step.activation?.parallel?.joinPolicy
      ? { parallelJoinPolicy: step.activation.parallel.joinPolicy }
      : {}),
    ...(typeof step.activation?.parallel?.maxActiveBranches === "number"
      ? { maxActiveBranches: step.activation.parallel.maxActiveBranches }
      : {}),
    ...(typeof step.activation?.parallel?.retryOnFail === "boolean"
      ? { retryOnFail: step.activation.parallel.retryOnFail }
      : {}),
    ...(typeof step.activation?.parallel?.maxTries === "number"
      ? { maxTries: step.activation.parallel.maxTries }
      : {}),
    ...(typeof step.activation?.parallel?.waitBetweenTriesMs === "number"
      ? { waitBetweenTriesMs: step.activation.parallel.waitBetweenTriesMs }
      : {}),
    ...(step.compensation
      ? {
          compensation: {
            ...(step.compensation.mode ? { mode: step.compensation.mode } : {}),
            ...(typeof step.compensation.goal === "string" && step.compensation.goal.trim()
              ? { goal: step.compensation.goal.trim() }
              : {}),
            ...(step.compensation.allowedTools?.length
              ? { allowedTools: [...step.compensation.allowedTools] }
              : {}),
            ...(step.compensation.allowedSkills?.length
              ? { allowedSkills: [...step.compensation.allowedSkills] }
              : {}),
            ...(typeof step.compensation.timeoutMs === "number"
              ? { timeoutMs: step.compensation.timeoutMs }
              : {}),
            ...(typeof step.compensation.maxSteps === "number"
              ? { maxSteps: step.compensation.maxSteps }
              : {}),
          },
        }
      : {}),
    ...(step.terminalOnSuccess ? { terminalOnSuccess: true } : {}),
    goal: step.goal?.trim() || step.title?.trim() || step.id,
    inputs: Object.fromEntries(spec.inputs.map((field) => [field.name, `$json.${field.name}`])),
    maxSteps: step.agent?.maxSteps ?? 8,
    timeoutMs: step.agent?.timeoutMs ?? 300_000,
    ...(step.agent?.allowedTools?.length ? { allowedTools: step.agent.allowedTools } : {}),
    ...(allowedSkills.length > 0 ? { allowedSkills } : {}),
    ...(spec.sourceWorkspaceDir || spec.sourceAgentDir
      ? {
          workspaceBinding: {
            ...(spec.sourceWorkspaceDir ? { workspaceDir: spec.sourceWorkspaceDir } : {}),
            ...(spec.sourceAgentDir ? { agentDir: spec.sourceAgentDir } : {}),
          },
        }
      : {}),
    ...(spec.sourceSessionKey || spec.sourceSessionId
      ? {
          sessionBinding: {
            ...(spec.sourceSessionKey ? { ownerSessionKey: spec.sourceSessionKey } : {}),
            ...(spec.sourceSessionId ? { sessionId: spec.sourceSessionId } : {}),
          },
        }
      : {}),
    ...(step.agent?.resultSchema ? { resultSchema: step.agent.resultSchema } : {}),
  });
}
