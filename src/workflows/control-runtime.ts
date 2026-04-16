import {
  listAgentIds,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import type { CrawClawConfig } from "../config/config.js";
import {
  cancelWorkflowExecution,
  readWorkflowExecutionStatus,
  requireWorkflowN8nRuntime,
  resumeWorkflowExecution,
  WorkflowOperationInputError,
  WorkflowOperationUnavailableError,
} from "./api.js";
import type { WorkflowStoreContext } from "./store.js";

export type ResolvedWorkflowControlContext = WorkflowStoreContext & {
  cfg: CrawClawConfig;
  agentId: string;
};

type WorkflowActionBaseParams = {
  context: WorkflowStoreContext;
  config?: CrawClawConfig;
  executionId: string;
};

type WorkflowStatusActionParams = WorkflowActionBaseParams & {
  action: "status";
};

type WorkflowCancelActionParams = WorkflowActionBaseParams & {
  action: "cancel";
};

type WorkflowResumeActionParams = WorkflowActionBaseParams & {
  action: "resume";
  input?: string;
  actorLabel?: string;
};

export type WorkflowControlActionParams =
  | WorkflowStatusActionParams
  | WorkflowCancelActionParams
  | WorkflowResumeActionParams;

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveWorkflowControlContext(params: {
  cfg: CrawClawConfig;
  agentId?: string | null;
  workspaceDir?: string | null;
  agentDir?: string | null;
}): ResolvedWorkflowControlContext {
  const requestedAgentId = normalizeOptionalString(params.agentId);
  const knownAgents = listAgentIds(params.cfg);
  const agentId = requestedAgentId ?? resolveDefaultAgentId(params.cfg);

  if (requestedAgentId && !knownAgents.includes(agentId)) {
    throw new WorkflowOperationInputError(`unknown agent id "${requestedAgentId}"`);
  }

  return {
    cfg: params.cfg,
    agentId,
    workspaceDir:
      normalizeOptionalString(params.workspaceDir) ?? resolveAgentWorkspaceDir(params.cfg, agentId),
    agentDir: normalizeOptionalString(params.agentDir) ?? resolveAgentDir(params.cfg, agentId),
  };
}

export function requireWorkflowN8nRuntimeOrThrowUnavailable(
  config?: CrawClawConfig,
): ReturnType<typeof requireWorkflowN8nRuntime> {
  try {
    return requireWorkflowN8nRuntime(config);
  } catch (error) {
    if (error instanceof Error && error.message.includes("n8n is not configured")) {
      throw new WorkflowOperationUnavailableError(error.message);
    }
    throw error;
  }
}

export async function executeWorkflowControlAction(
  params: WorkflowStatusActionParams,
): Promise<Awaited<ReturnType<typeof readWorkflowExecutionStatus>>>;
export async function executeWorkflowControlAction(
  params: WorkflowCancelActionParams,
): Promise<Awaited<ReturnType<typeof cancelWorkflowExecution>>>;
export async function executeWorkflowControlAction(
  params: WorkflowResumeActionParams,
): Promise<Awaited<ReturnType<typeof resumeWorkflowExecution>>>;
export async function executeWorkflowControlAction(
  params: WorkflowControlActionParams,
): Promise<unknown> {
  const executionId = params.executionId.trim();
  const { client, resolved } = requireWorkflowN8nRuntimeOrThrowUnavailable(params.config);
  if (params.action === "status") {
    return await readWorkflowExecutionStatus({
      context: params.context,
      client,
      n8nBaseUrl: resolved.baseUrl,
      executionId,
    });
  }
  if (params.action === "cancel") {
    return await cancelWorkflowExecution({
      context: params.context,
      client,
      n8nBaseUrl: resolved.baseUrl,
      executionId,
    });
  }
  return await resumeWorkflowExecution({
    context: params.context,
    client,
    n8nBaseUrl: resolved.baseUrl,
    executionId,
    input: normalizeOptionalString(params.input),
    actorLabel: normalizeOptionalString(params.actorLabel) ?? "workflow control",
  });
}
