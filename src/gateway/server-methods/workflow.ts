import { loadConfig } from "../../config/config.js";
import { createPluginRuntime } from "../../plugins/runtime/index.js";
import { buildAgentMainSessionKey } from "../../routing/session-key.js";
import {
  buildWorkflowCatalogPayload,
  buildWorkflowDiffPayload,
  buildWorkflowMatchPayload,
  buildWorkflowRunsPayload,
  buildWorkflowVersionsPayload,
  createN8nClient,
  deleteWorkflowPayload,
  describeWorkflowWithRecentExecutions,
  deployWorkflowDefinition,
  handleWorkflowAgentNodeCallback,
  normalizeWorkflowAgentNodeRequest,
  resolveN8nConfig,
  resolveRunnableWorkflowForExecution,
  rollbackWorkflowWithOptionalRepublish,
  setWorkflowArchivedPayload,
  setWorkflowEnabledPayload,
  startWorkflowExecution,
  updateWorkflowDefinitionPayload,
  WorkflowOperationInputError,
  WorkflowOperationUnavailableError,
  type WorkflowAgentNodeRequest,
  type WorkflowDefinitionPatch,
  type WorkflowStoreContext,
} from "../../workflows/api.js";
import {
  executeWorkflowControlAction,
  requireWorkflowN8nRuntimeOrThrowUnavailable,
  resolveWorkflowControlContext,
} from "../../workflows/control-runtime.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { respondUnavailableOnThrow } from "./nodes.helpers.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalStringArray(value: unknown): value is readonly string[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  );
}

function isOptionalPositiveNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value > 0);
}

function isOptionalWorkflowActivation(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isPlainRecord(value)) {
    return false;
  }
  if (
    !isOptionalString(value.mode) ||
    !isOptionalString(value.when) ||
    !isOptionalStringArray(value.fromStepIds)
  ) {
    return false;
  }
  return true;
}

function readTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function buildWorkflowOperatorSessionKey(agentId: string): string {
  return buildAgentMainSessionKey({ agentId });
}

function respondInvalid(respond: RespondFn, message: string) {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function respondUnavailable(respond: RespondFn, message: string) {
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
}

type ResolvedWorkflowContext = WorkflowStoreContext & {
  cfg: ReturnType<typeof loadConfig>;
  agentId: string;
};

function resolveWorkflowStoreContext(
  params: Record<string, unknown>,
  respond: RespondFn,
): ResolvedWorkflowContext | null {
  try {
    return resolveWorkflowControlContext({
      cfg: loadConfig(),
      agentId: readTrimmedString(params.agentId),
      workspaceDir: readTrimmedString(params.workspaceDir),
      agentDir: readTrimmedString(params.agentDir),
    });
  } catch (error) {
    if (error instanceof WorkflowOperationInputError) {
      respondInvalid(respond, error.message);
      return null;
    }
    throw error;
  }
}

function resolveN8nRuntimeOrRespond(
  context: ResolvedWorkflowContext,
  respond: RespondFn,
): {
  resolved: NonNullable<ReturnType<typeof resolveN8nConfig>>;
  client: ReturnType<typeof createN8nClient>;
} | null {
  try {
    return requireWorkflowN8nRuntimeOrThrowUnavailable(context.cfg);
  } catch (error) {
    if (error instanceof WorkflowOperationUnavailableError) {
      respondUnavailable(respond, error.message);
      return null;
    }
    throw error;
  }
}

export function validateWorkflowAgentRunParams(value: unknown): value is WorkflowAgentNodeRequest {
  if (!isPlainRecord(value)) {
    return false;
  }
  if (
    typeof value.workflowId !== "string" ||
    !value.workflowId.trim() ||
    typeof value.executionId !== "string" ||
    !value.executionId.trim() ||
    typeof value.stepId !== "string" ||
    !value.stepId.trim() ||
    typeof value.goal !== "string" ||
    !value.goal.trim()
  ) {
    return false;
  }
  if (!isOptionalNullableString(value.localExecutionId)) {
    return false;
  }
  if (
    !isOptionalString(value.topology) ||
    !isOptionalString(value.stepPath) ||
    !isOptionalString(value.branchGroup)
  ) {
    return false;
  }
  if (
    !isOptionalWorkflowActivation(value.activation) ||
    !isOptionalBoolean(value.terminalOnSuccess)
  ) {
    return false;
  }
  if (
    value.parallelFailurePolicy !== undefined &&
    value.parallelFailurePolicy !== "fail_fast" &&
    value.parallelFailurePolicy !== "continue"
  ) {
    return false;
  }
  if (
    value.parallelJoinPolicy !== undefined &&
    value.parallelJoinPolicy !== "all" &&
    value.parallelJoinPolicy !== "best_effort"
  ) {
    return false;
  }
  if (
    !isOptionalPositiveNumber(value.maxActiveBranches) ||
    !isOptionalBoolean(value.retryOnFail) ||
    !isOptionalPositiveNumber(value.maxTries) ||
    (value.waitBetweenTriesMs !== undefined &&
      (typeof value.waitBetweenTriesMs !== "number" ||
        !Number.isFinite(value.waitBetweenTriesMs) ||
        value.waitBetweenTriesMs < 0))
  ) {
    return false;
  }
  if (value.compensation !== undefined) {
    if (!isPlainRecord(value.compensation)) {
      return false;
    }
    if (
      value.compensation.mode !== undefined &&
      value.compensation.mode !== "none" &&
      value.compensation.mode !== "crawclaw_agent"
    ) {
      return false;
    }
    if (
      !isOptionalString(value.compensation.goal) ||
      !isOptionalStringArray(value.compensation.allowedTools) ||
      !isOptionalStringArray(value.compensation.allowedSkills) ||
      !isOptionalPositiveNumber(value.compensation.timeoutMs) ||
      !isOptionalPositiveNumber(value.compensation.maxSteps)
    ) {
      return false;
    }
  }
  if (!isOptionalStringArray(value.allowedTools) || !isOptionalStringArray(value.allowedSkills)) {
    return false;
  }
  if (!isOptionalPositiveNumber(value.timeoutMs) || !isOptionalPositiveNumber(value.maxSteps)) {
    return false;
  }
  if (value.inputs !== undefined && !isPlainRecord(value.inputs)) {
    return false;
  }
  if (value.resultSchema !== undefined && !isPlainRecord(value.resultSchema)) {
    return false;
  }
  if (value.workspaceBinding !== undefined) {
    if (!isPlainRecord(value.workspaceBinding)) {
      return false;
    }
    if (
      !isOptionalString(value.workspaceBinding.workspaceDir) ||
      !isOptionalString(value.workspaceBinding.agentDir)
    ) {
      return false;
    }
  }
  if (value.sessionBinding !== undefined) {
    if (!isPlainRecord(value.sessionBinding)) {
      return false;
    }
    if (
      !isOptionalString(value.sessionBinding.sessionKey) ||
      !isOptionalString(value.sessionBinding.ownerSessionKey) ||
      !isOptionalString(value.sessionBinding.sessionId)
    ) {
      return false;
    }
  }
  const workspaceDir =
    typeof value.workspaceBinding?.workspaceDir === "string"
      ? value.workspaceBinding.workspaceDir.trim()
      : "";
  const agentDir =
    typeof value.workspaceBinding?.agentDir === "string"
      ? value.workspaceBinding.agentDir.trim()
      : "";
  return Boolean(workspaceDir || agentDir);
}

export async function executeWorkflowAgentRun(
  request: WorkflowAgentNodeRequest,
): Promise<Awaited<ReturnType<typeof handleWorkflowAgentNodeCallback>>> {
  const normalized = normalizeWorkflowAgentNodeRequest(request);
  const subagent = createPluginRuntime({ allowGatewaySubagentBinding: true }).subagent;
  return await handleWorkflowAgentNodeCallback(
    {
      workspaceDir: normalized.workspaceBinding?.workspaceDir,
      agentDir: normalized.workspaceBinding?.agentDir,
    },
    {
      subagent,
      request: normalized,
    },
  );
}

export const workflowHandlers: GatewayRequestHandlers = {
  "workflow.list": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      !isOptionalBoolean(params.includeDisabled) ||
      !isOptionalPositiveNumber(params.limit)
    ) {
      respondInvalid(
        respond,
        "invalid workflow.list params: expected optional agentId/workspaceDir/agentDir, includeDisabled, and positive limit",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    respond(
      true,
      {
        agentId: resolved.agentId,
        ...(await buildWorkflowCatalogPayload({
          context: resolved,
          limit: readPositiveInteger(params.limit),
          includeDisabled: params.includeDisabled === true,
        })),
      },
      undefined,
    );
  },
  "workflow.get": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim() ||
      !isOptionalPositiveNumber(params.recentRunsLimit)
    ) {
      respondInvalid(
        respond,
        "invalid workflow.get params: expected workflow plus optional agentId/workspaceDir/agentDir and recentRunsLimit",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    const described = await describeWorkflowWithRecentExecutions(
      resolved,
      params.workflow,
      readPositiveInteger(params.recentRunsLimit) ?? 5,
    );
    if (!described) {
      respondInvalid(respond, `Workflow "${params.workflow}" not found.`);
      return;
    }
    respond(
      true,
      {
        agentId: resolved.agentId,
        ...described,
      },
      undefined,
    );
  },
  "workflow.match": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.query !== "string" ||
      !params.query.trim() ||
      !isOptionalPositiveNumber(params.limit) ||
      !isOptionalBoolean(params.enabledOnly) ||
      !isOptionalBoolean(params.deployedOnly) ||
      !isOptionalBoolean(params.autoRunnableOnly)
    ) {
      respondInvalid(
        respond,
        "invalid workflow.match params: expected query plus optional agentId/workspaceDir/agentDir, positive limit, and boolean enabledOnly/deployedOnly/autoRunnableOnly",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    respond(
      true,
      {
        agentId: resolved.agentId,
        ...(await buildWorkflowMatchPayload({
          context: resolved,
          query: params.query,
          limit: readPositiveInteger(params.limit) ?? 5,
          enabledOnly: params.enabledOnly === true,
          deployedOnly: params.deployedOnly === true,
          autoRunnableOnly: params.autoRunnableOnly === true,
        })),
      },
      undefined,
    );
  },
  "workflow.versions": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim()
    ) {
      respondInvalid(
        respond,
        "invalid workflow.versions params: expected workflow plus optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    const versions = await buildWorkflowVersionsPayload(resolved, params.workflow);
    if (!versions) {
      respondInvalid(respond, `Workflow "${params.workflow}" not found.`);
      return;
    }
    respond(
      true,
      {
        agentId: resolved.agentId,
        ...versions,
      },
      undefined,
    );
  },
  "workflow.diff": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim() ||
      !isOptionalPositiveNumber(params.specVersion) ||
      !isOptionalPositiveNumber(params.toSpecVersion)
    ) {
      respondInvalid(
        respond,
        "invalid workflow.diff params: expected workflow plus optional specVersion/toSpecVersion and optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    try {
      respond(
        true,
        {
          agentId: resolved.agentId,
          ...(await buildWorkflowDiffPayload({
            context: resolved,
            workflowRef: params.workflow,
            ...(readPositiveInteger(params.specVersion)
              ? { specVersion: readPositiveInteger(params.specVersion) }
              : {}),
            ...(readPositiveInteger(params.toSpecVersion)
              ? { toSpecVersion: readPositiveInteger(params.toSpecVersion) }
              : {}),
          })),
        },
        undefined,
      );
    } catch (error) {
      if (error instanceof WorkflowOperationInputError) {
        respondInvalid(respond, error.message);
        return;
      }
      throw error;
    }
  },
  "workflow.update": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim() ||
      !isPlainRecord(params.patch)
    ) {
      respondInvalid(
        respond,
        "invalid workflow.update params: expected workflow, patch object, and optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    const workflowRef = params.workflow;
    await respondUnavailableOnThrow(respond, async () => {
      try {
        respond(
          true,
          {
            agentId: resolved.agentId,
            ...(await updateWorkflowDefinitionPayload({
              context: resolved,
              workflowRef,
              patch: params.patch as WorkflowDefinitionPatch,
              sessionKey: buildWorkflowOperatorSessionKey(resolved.agentId),
            })),
          },
          undefined,
        );
      } catch (error) {
        if (error instanceof WorkflowOperationInputError) {
          respondInvalid(respond, error.message);
          return;
        }
        throw error;
      }
    });
  },
  "workflow.runs": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      !isOptionalString(params.workflow) ||
      !isOptionalPositiveNumber(params.limit)
    ) {
      respondInvalid(
        respond,
        "invalid workflow.runs params: expected optional workflow plus optional agentId/workspaceDir/agentDir and positive limit",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    try {
      respond(
        true,
        {
          agentId: resolved.agentId,
          ...(await buildWorkflowRunsPayload({
            context: resolved,
            ...(readTrimmedString(params.workflow)
              ? { workflowRef: readTrimmedString(params.workflow) ?? undefined }
              : {}),
            ...(readPositiveInteger(params.limit)
              ? { limit: readPositiveInteger(params.limit) }
              : {}),
          })),
        },
        undefined,
      );
    } catch (error) {
      if (error instanceof WorkflowOperationInputError) {
        respondInvalid(respond, error.message);
        return;
      }
      throw error;
    }
  },
  "workflow.enable": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim()
    ) {
      respondInvalid(
        respond,
        "invalid workflow.enable params: expected workflow plus optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    try {
      respond(
        true,
        {
          agentId: resolved.agentId,
          ...(await setWorkflowEnabledPayload({
            context: resolved,
            workflowRef: params.workflow,
            enabled: true,
          })),
        },
        undefined,
      );
    } catch (error) {
      if (error instanceof WorkflowOperationInputError) {
        respondInvalid(respond, error.message);
        return;
      }
      throw error;
    }
  },
  "workflow.disable": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim()
    ) {
      respondInvalid(
        respond,
        "invalid workflow.disable params: expected workflow plus optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    try {
      respond(
        true,
        {
          agentId: resolved.agentId,
          ...(await setWorkflowEnabledPayload({
            context: resolved,
            workflowRef: params.workflow,
            enabled: false,
          })),
        },
        undefined,
      );
    } catch (error) {
      if (error instanceof WorkflowOperationInputError) {
        respondInvalid(respond, error.message);
        return;
      }
      throw error;
    }
  },
  "workflow.archive": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim()
    ) {
      respondInvalid(
        respond,
        "invalid workflow.archive params: expected workflow plus optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    try {
      respond(
        true,
        {
          agentId: resolved.agentId,
          ...(await setWorkflowArchivedPayload({
            context: resolved,
            workflowRef: params.workflow,
            archived: true,
          })),
        },
        undefined,
      );
    } catch (error) {
      if (error instanceof WorkflowOperationInputError) {
        respondInvalid(respond, error.message);
        return;
      }
      throw error;
    }
  },
  "workflow.unarchive": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim()
    ) {
      respondInvalid(
        respond,
        "invalid workflow.unarchive params: expected workflow plus optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    try {
      respond(
        true,
        {
          agentId: resolved.agentId,
          ...(await setWorkflowArchivedPayload({
            context: resolved,
            workflowRef: params.workflow,
            archived: false,
          })),
        },
        undefined,
      );
    } catch (error) {
      if (error instanceof WorkflowOperationInputError) {
        respondInvalid(respond, error.message);
        return;
      }
      throw error;
    }
  },
  "workflow.delete": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim()
    ) {
      respondInvalid(
        respond,
        "invalid workflow.delete params: expected workflow plus optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    try {
      respond(
        true,
        {
          agentId: resolved.agentId,
          ...(await deleteWorkflowPayload(resolved, params.workflow)),
        },
        undefined,
      );
    } catch (error) {
      if (error instanceof WorkflowOperationInputError) {
        respondInvalid(respond, error.message);
        return;
      }
      throw error;
    }
  },
  "workflow.deploy": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim()
    ) {
      respondInvalid(
        respond,
        "invalid workflow.deploy params: expected workflow plus optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    const workflowRef = params.workflow;
    await respondUnavailableOnThrow(respond, async () => {
      const deployedResult = await deployWorkflowDefinition({
        context: resolved,
        config: resolved.cfg,
        workflowRef,
        publishedBySessionKey: buildWorkflowOperatorSessionKey(resolved.agentId),
      });
      respond(
        true,
        {
          agentId: resolved.agentId,
          workflow: deployedResult.deployed,
          remoteWorkflow: deployedResult.remote,
          compiled: deployedResult.compiled,
        },
        undefined,
      );
    });
  },
  "workflow.republish": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim() ||
      !isOptionalString(params.summary)
    ) {
      respondInvalid(
        respond,
        "invalid workflow.republish params: expected workflow plus optional summary and optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    const workflowRef = params.workflow;
    await respondUnavailableOnThrow(respond, async () => {
      const deployedResult = await deployWorkflowDefinition({
        context: resolved,
        config: resolved.cfg,
        workflowRef,
        summary: readTrimmedString(params.summary) ?? undefined,
        requireExistingDeployment: true,
        publishedBySessionKey: buildWorkflowOperatorSessionKey(resolved.agentId),
      });
      respond(
        true,
        {
          agentId: resolved.agentId,
          workflow: deployedResult.deployed,
          remoteWorkflow: deployedResult.remote,
          compiled: deployedResult.compiled,
          republished: true,
        },
        undefined,
      );
    });
  },
  "workflow.rollback": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim() ||
      !isOptionalPositiveNumber(params.specVersion) ||
      params.specVersion === undefined ||
      !isOptionalBoolean(params.republish) ||
      !isOptionalString(params.summary)
    ) {
      respondInvalid(
        respond,
        "invalid workflow.rollback params: expected workflow, specVersion, optional republish/summary, and optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    const workflowRef = params.workflow;
    await respondUnavailableOnThrow(respond, async () => {
      const specVersion = readPositiveInteger(params.specVersion);
      if (!specVersion) {
        throw new Error("specVersion required");
      }
      try {
        respond(
          true,
          {
            agentId: resolved.agentId,
            ...(await rollbackWorkflowWithOptionalRepublish({
              context: resolved,
              config: resolved.cfg,
              workflowRef,
              specVersion,
              republish: params.republish === true,
              ...(readTrimmedString(params.summary)
                ? { summary: readTrimmedString(params.summary) ?? undefined }
                : {}),
              sessionKey: buildWorkflowOperatorSessionKey(resolved.agentId),
            })),
          },
          undefined,
        );
      } catch (error) {
        if (error instanceof WorkflowOperationInputError) {
          respondInvalid(respond, error.message);
          return;
        }
        throw error;
      }
    });
  },
  "workflow.run": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.workflow !== "string" ||
      !params.workflow.trim() ||
      (params.inputs !== undefined && !isPlainRecord(params.inputs))
    ) {
      respondInvalid(
        respond,
        "invalid workflow.run params: expected workflow plus optional agentId/workspaceDir/agentDir and optional object inputs",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    const runtime = resolveN8nRuntimeOrRespond(resolved, respond);
    if (!runtime) {
      return;
    }
    const { client, resolved: n8nResolved } = runtime;
    let described;
    try {
      described = await resolveRunnableWorkflowForExecution(resolved, params.workflow);
    } catch (error) {
      if (error instanceof WorkflowOperationInputError) {
        respondInvalid(respond, error.message);
        return;
      }
      throw error;
    }
    await respondUnavailableOnThrow(respond, async () => {
      const workflowInputs = isPlainRecord(params.inputs) ? params.inputs : undefined;
      const started = await startWorkflowExecution({
        context: resolved,
        client,
        n8nBaseUrl: n8nResolved.baseUrl,
        workflowId: described.entry.workflowId,
        workflowName: described.entry.name,
        n8nWorkflowId: described.entry.n8nWorkflowId,
        spec: described.spec,
        ...(workflowInputs ? { workflowInputs } : {}),
      });
      respond(
        true,
        {
          agentId: resolved.agentId,
          workflow: described.entry,
          ...started,
        },
        undefined,
      );
    });
  },
  "workflow.status": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.executionId !== "string" ||
      !params.executionId.trim()
    ) {
      respondInvalid(
        respond,
        "invalid workflow.status params: expected executionId plus optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    const executionId = params.executionId.trim();
    await respondUnavailableOnThrow(respond, async () => {
      respond(
        true,
        {
          agentId: resolved.agentId,
          ...(await executeWorkflowControlAction({
            action: "status",
            context: resolved,
            config: resolved.cfg,
            executionId,
          })),
        },
        undefined,
      );
    });
  },
  "workflow.cancel": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.executionId !== "string" ||
      !params.executionId.trim()
    ) {
      respondInvalid(
        respond,
        "invalid workflow.cancel params: expected executionId plus optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    const executionId = params.executionId.trim();
    await respondUnavailableOnThrow(respond, async () => {
      respond(
        true,
        {
          agentId: resolved.agentId,
          ...(await executeWorkflowControlAction({
            action: "cancel",
            context: resolved,
            config: resolved.cfg,
            executionId,
          })),
        },
        undefined,
      );
    });
  },
  "workflow.resume": async ({ params, respond }) => {
    if (
      !isPlainRecord(params) ||
      !isOptionalString(params.agentId) ||
      !isOptionalString(params.workspaceDir) ||
      !isOptionalString(params.agentDir) ||
      typeof params.executionId !== "string" ||
      !params.executionId.trim() ||
      !isOptionalString(params.input)
    ) {
      respondInvalid(
        respond,
        "invalid workflow.resume params: expected executionId plus optional input and optional agentId/workspaceDir/agentDir",
      );
      return;
    }
    const resolved = resolveWorkflowStoreContext(params, respond);
    if (!resolved) {
      return;
    }
    const executionId = params.executionId.trim();
    await respondUnavailableOnThrow(respond, async () => {
      try {
        const resumed = await executeWorkflowControlAction({
          action: "resume",
          context: resolved,
          config: resolved.cfg,
          executionId,
          input: readTrimmedString(params.input) ?? undefined,
          actorLabel: "gateway",
        });
        respond(
          true,
          {
            agentId: resolved.agentId,
            ...resumed,
          },
          undefined,
        );
      } catch (error) {
        if (error instanceof WorkflowOperationInputError) {
          respondInvalid(respond, error.message);
          return;
        }
        if (error instanceof WorkflowOperationUnavailableError) {
          respondUnavailable(respond, error.message);
          return;
        }
        throw error;
      }
    });
  },
  "workflow.agent.run": async ({ params, respond }) => {
    if (!validateWorkflowAgentRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid workflow.agent.run params: expected workflow/step ids, goal, and workspaceBinding.workspaceDir or workspaceBinding.agentDir",
        ),
      );
      return;
    }

    await respondUnavailableOnThrow(respond, async () => {
      const handled = await executeWorkflowAgentRun(params);
      respond(true, handled, undefined);
    });
  },
};
