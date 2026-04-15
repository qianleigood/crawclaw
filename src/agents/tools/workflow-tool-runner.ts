import {
  buildWorkflowCatalogPayload,
  buildWorkflowDiffPayload,
  buildWorkflowMatchPayload,
  buildWorkflowRunsPayload,
  buildWorkflowVersionsPayload,
  cancelWorkflowExecution,
  deleteWorkflowPayload,
  describeWorkflowWithRecentExecutions,
  deployWorkflowDefinition,
  readWorkflowExecutionStatus,
  requireWorkflowN8nRuntime,
  resolveRunnableWorkflowForExecution,
  rollbackWorkflowWithOptionalRepublish,
  resumeWorkflowExecution,
  setWorkflowArchivedPayload,
  setWorkflowEnabledPayload,
  startWorkflowExecution,
  updateWorkflowDefinitionPayload,
  WorkflowOperationInputError,
  WorkflowOperationUnavailableError,
  type WorkflowDefinitionPatch,
} from "../../workflows/api.js";
import { jsonResult, readNumberParam, readStringParam, ToolInputError } from "./common.js";

export type WorkflowToolOptions = {
  workspaceDir?: string;
  agentDir?: string;
  sessionKey?: string;
  sessionId?: string;
  config?: import("../../config/config.js").CrawClawConfig;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseWorkflowPatch(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new ToolInputError("workflow.update patch must be a JSON object.");
  }
  return value;
}

function buildWorkflowContext(opts?: WorkflowToolOptions) {
  return {
    workspaceDir: opts?.workspaceDir,
    agentDir: opts?.agentDir,
  };
}

export async function executeWorkflowToolAction(
  opts: WorkflowToolOptions | undefined,
  args: Record<string, unknown>,
) {
  const action = readStringParam(args, "action", { required: true });
  const enabledOnly = typeof args.enabledOnly === "boolean" ? args.enabledOnly : undefined;
  const deployedOnly = typeof args.deployedOnly === "boolean" ? args.deployedOnly : undefined;
  const autoRunnableOnly =
    typeof args.autoRunnableOnly === "boolean" ? args.autoRunnableOnly : undefined;
  const context = buildWorkflowContext(opts);

  const resolveClient = () => requireWorkflowN8nRuntime(opts?.config);
  const deployWorkflowSpec = async (params: {
    workflow: string;
    summary?: string;
    requireExistingDeployment?: boolean;
  }) =>
    deployWorkflowDefinition({
      context,
      config: opts?.config,
      workflowRef: params.workflow,
      summary: params.summary,
      requireExistingDeployment: params.requireExistingDeployment,
      publishedBySessionKey: opts?.sessionKey,
    });

  switch (action) {
    case "list": {
      const limit = readNumberParam(args, "limit", { integer: true });
      return jsonResult({
        status: "ok",
        ...(await buildWorkflowCatalogPayload({
          context,
          limit,
          includeDisabled: true,
        })),
      });
    }
    case "describe": {
      const workflow = readStringParam(args, "workflow", { required: true });
      const described = await describeWorkflowWithRecentExecutions(context, workflow);
      if (!described) {
        throw new ToolInputError(`Workflow "${workflow}" not found.`);
      }
      return jsonResult({
        status: "ok",
        ...described,
      });
    }
    case "match": {
      const query = readStringParam(args, "query", { required: true });
      const limit = readNumberParam(args, "limit", { integer: true });
      return jsonResult({
        status: "ok",
        ...(await buildWorkflowMatchPayload({
          context,
          query,
          limit: typeof limit === "number" ? limit : 5,
          enabledOnly,
          deployedOnly,
          autoRunnableOnly,
        })),
      });
    }
    case "versions": {
      const workflow = readStringParam(args, "workflow", { required: true });
      const versions = await buildWorkflowVersionsPayload(context, workflow);
      if (!versions) {
        throw new ToolInputError(`Workflow "${workflow}" not found.`);
      }
      return jsonResult({
        status: "ok",
        ...versions,
      });
    }
    case "diff": {
      const workflow = readStringParam(args, "workflow", { required: true });
      const fromSpecVersion = readNumberParam(args, "specVersion", { integer: true });
      const toSpecVersion = readNumberParam(args, "toSpecVersion", { integer: true });
      try {
        return jsonResult({
          status: "ok",
          ...(await buildWorkflowDiffPayload({
            context,
            workflowRef: workflow,
            ...(typeof fromSpecVersion === "number" ? { specVersion: fromSpecVersion } : {}),
            ...(typeof toSpecVersion === "number" ? { toSpecVersion } : {}),
          })),
        });
      } catch (error) {
        if (error instanceof WorkflowOperationInputError) {
          throw new ToolInputError(error.message);
        }
        throw error;
      }
    }
    case "update": {
      const workflow = readStringParam(args, "workflow", { required: true });
      const patch = parseWorkflowPatch(args.patch);
      try {
        return jsonResult({
          status: "ok",
          ...(await updateWorkflowDefinitionPayload({
            context,
            workflowRef: workflow,
            patch: patch as WorkflowDefinitionPatch,
            ...(opts?.sessionKey ? { sessionKey: opts.sessionKey } : {}),
          })),
        });
      } catch (error) {
        if (error instanceof WorkflowOperationInputError) {
          throw new ToolInputError(error.message);
        }
        throw error;
      }
    }
    case "runs": {
      const workflow = readStringParam(args, "workflow");
      const limit = readNumberParam(args, "limit", { integer: true });
      try {
        return jsonResult({
          status: "ok",
          ...(await buildWorkflowRunsPayload({
            context,
            ...(workflow ? { workflowRef: workflow } : {}),
            ...(typeof limit === "number" ? { limit } : {}),
          })),
        });
      } catch (error) {
        if (error instanceof WorkflowOperationInputError) {
          throw new ToolInputError(error.message);
        }
        throw error;
      }
    }
    case "enable":
    case "disable": {
      const workflow = readStringParam(args, "workflow", { required: true });
      try {
        return jsonResult({
          status: "ok",
          ...(await setWorkflowEnabledPayload({
            context,
            workflowRef: workflow,
            enabled: action === "enable",
          })),
        });
      } catch (error) {
        if (error instanceof WorkflowOperationInputError) {
          throw new ToolInputError(error.message);
        }
        throw error;
      }
    }
    case "archive":
    case "unarchive": {
      const workflow = readStringParam(args, "workflow", { required: true });
      try {
        return jsonResult({
          status: "ok",
          ...(await setWorkflowArchivedPayload({
            context,
            workflowRef: workflow,
            archived: action === "archive",
          })),
        });
      } catch (error) {
        if (error instanceof WorkflowOperationInputError) {
          throw new ToolInputError(error.message);
        }
        throw error;
      }
    }
    case "delete": {
      const workflow = readStringParam(args, "workflow", { required: true });
      try {
        return jsonResult({
          status: "ok",
          ...(await deleteWorkflowPayload(context, workflow)),
        });
      } catch (error) {
        if (error instanceof WorkflowOperationInputError) {
          throw new ToolInputError(error.message);
        }
        throw error;
      }
    }
    case "deploy": {
      const workflow = readStringParam(args, "workflow", { required: true });
      const deployedResult = await deployWorkflowSpec({ workflow });
      return jsonResult({
        status: "ok",
        workflow: deployedResult.deployed,
        remoteWorkflow: deployedResult.remote,
        compiled: deployedResult.compiled,
      });
    }
    case "republish": {
      const workflow = readStringParam(args, "workflow", { required: true });
      const summary = readStringParam(args, "summary");
      const deployedResult = await deployWorkflowSpec({
        workflow,
        summary,
        requireExistingDeployment: true,
      });
      return jsonResult({
        status: "ok",
        workflow: deployedResult.deployed,
        remoteWorkflow: deployedResult.remote,
        compiled: deployedResult.compiled,
        republished: true,
      });
    }
    case "rollback": {
      const workflow = readStringParam(args, "workflow", { required: true });
      const specVersion = readNumberParam(args, "specVersion", {
        required: true,
        integer: true,
      });
      if (specVersion === undefined) {
        throw new ToolInputError("specVersion required");
      }
      const republish = args.republish === true;
      const summary = readStringParam(args, "summary");
      try {
        return jsonResult({
          status: "ok",
          ...(await rollbackWorkflowWithOptionalRepublish({
            context,
            config: opts?.config,
            workflowRef: workflow,
            specVersion,
            republish,
            ...(summary ? { summary } : {}),
            ...(opts?.sessionKey ? { sessionKey: opts.sessionKey } : {}),
          })),
        });
      } catch (error) {
        if (error instanceof WorkflowOperationInputError) {
          throw new ToolInputError(error.message);
        }
        throw error;
      }
    }
    case "run": {
      const workflow = readStringParam(args, "workflow", { required: true });
      const workflowInputs = (() => {
        const value = args.inputs;
        if (value === undefined) {
          return undefined;
        }
        if (!isPlainRecord(value)) {
          throw new ToolInputError("workflow.run inputs must be a JSON object.");
        }
        return value;
      })();
      let described;
      try {
        described = await resolveRunnableWorkflowForExecution(context, workflow);
      } catch (error) {
        if (error instanceof WorkflowOperationInputError) {
          throw new ToolInputError(error.message);
        }
        throw error;
      }
      const { client, resolved } = resolveClient();
      const n8nWorkflowId = described.entry.n8nWorkflowId;
      if (!n8nWorkflowId) {
        throw new ToolInputError(
          `Workflow "${workflow}" is not currently deployed. Run workflow.deploy or workflow.republish first.`,
        );
      }
      const started = await startWorkflowExecution({
        context,
        client,
        n8nBaseUrl: resolved.baseUrl,
        workflowId: described.entry.workflowId,
        workflowName: described.entry.name,
        n8nWorkflowId,
        spec: described.spec ?? undefined,
        ...(workflowInputs ? { workflowInputs } : {}),
      });
      return jsonResult({
        status: "ok",
        workflow: described.entry,
        ...started,
      });
    }
    case "status": {
      const executionId = readStringParam(args, "executionId", { required: true });
      const { client, resolved } = resolveClient();
      return jsonResult({
        status: "ok",
        ...(await readWorkflowExecutionStatus({
          context,
          client,
          n8nBaseUrl: resolved.baseUrl,
          executionId,
        })),
      });
    }
    case "cancel": {
      const executionId = readStringParam(args, "executionId", { required: true });
      const { client, resolved } = resolveClient();
      return jsonResult({
        status: "ok",
        ...(await cancelWorkflowExecution({
          context,
          client,
          n8nBaseUrl: resolved.baseUrl,
          executionId,
        })),
      });
    }
    case "resume": {
      const executionId = readStringParam(args, "executionId", { required: true });
      const input = readStringParam(args, "input");
      const { client, resolved } = resolveClient();
      try {
        return jsonResult({
          status: "ok",
          ...(await resumeWorkflowExecution({
            context,
            client,
            n8nBaseUrl: resolved.baseUrl,
            executionId,
            input,
            actorLabel: "workflow tool",
          })),
        });
      } catch (error) {
        if (
          error instanceof WorkflowOperationInputError ||
          error instanceof WorkflowOperationUnavailableError
        ) {
          throw new ToolInputError(error.message);
        }
        throw error;
      }
    }
    default:
      throw new ToolInputError(`Unsupported workflow action "${action}".`);
  }
}
