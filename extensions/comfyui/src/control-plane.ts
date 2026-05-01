import type { CrawClawPluginApi, GatewayRequestHandlerOptions } from "../runtime-api.js";
import { resolveComfyUiConfig } from "./config.js";
import {
  listWorkflowArtifacts,
  listWorkflowOutputSummaries,
  listWorkflowRunRecords,
  loadWorkflowDetail,
} from "./store.js";
import { createComfyUiWorkflowTool } from "./tool.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

function readLimit(params: Record<string, unknown>, fallback: number): number {
  const value = params.limit;
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function defaultAgentId(config: CrawClawPluginApi["config"]): string {
  const list = config.agents?.list;
  if (!Array.isArray(list)) {
    return "main";
  }
  const defaultAgent = list.find((agent) => agent.default === true);
  return defaultAgent?.id ?? list[0]?.id ?? "main";
}

function resolveControlPlaneContext(api: CrawClawPluginApi, params: Record<string, unknown>) {
  const agentId = readStringParam(params, "agentId") ?? defaultAgentId(api.config);
  const workspaceDir =
    readStringParam(params, "workspaceDir") ??
    api.runtime.agent.resolveAgentWorkspaceDir(api.config, agentId);
  return { agentId, workspaceDir };
}

async function executeComfyUiTool(
  api: CrawClawPluginApi,
  params: Record<string, unknown>,
): Promise<unknown> {
  const { agentId, workspaceDir } = resolveControlPlaneContext(api, params);
  const tool = createComfyUiWorkflowTool(
    {
      workspaceDir,
      agentId,
      config: api.config,
    },
    {
      pluginConfig: api.pluginConfig,
    },
  );
  const result = await tool.execute("comfyui-gateway", params);
  return (result as { details?: unknown }).details;
}

function registerReadMethod(
  api: CrawClawPluginApi,
  method: string,
  handler: (opts: GatewayRequestHandlerOptions) => Promise<void> | void,
): void {
  api.registerGatewayMethod(method, handler, { scope: "operator.read" });
}

export function registerComfyUiGatewayMethods(api: CrawClawPluginApi): void {
  const resolveConfig = (params: Record<string, unknown>) =>
    resolveComfyUiConfig({
      workspaceDir: resolveControlPlaneContext(api, params).workspaceDir,
      pluginConfig: api.pluginConfig,
    });

  registerReadMethod(api, "comfyui.status", ({ params, respond }) => {
    try {
      const { baseUrl, workflowsDir, outputDir } = resolveConfig(params);
      respond(true, { baseUrl, workflowsDir, outputDir });
    } catch (error) {
      respond(false, { error: errorMessage(error) });
    }
  });

  registerReadMethod(api, "comfyui.workflows.list", async ({ params, respond }) => {
    try {
      const config = resolveConfig(params);
      respond(true, {
        workflows: await listWorkflowArtifacts({
          workflowsDir: config.workflowsDir,
          limit: readLimit(params, 100),
        }),
      });
    } catch (error) {
      respond(false, { error: errorMessage(error) });
    }
  });

  registerReadMethod(api, "comfyui.workflow.get", async ({ params, respond }) => {
    try {
      const workflowId = readStringParam(params, "workflowId");
      if (!workflowId) {
        respond(false, { error: "workflowId required" });
        return;
      }
      respond(true, {
        workflow: await loadWorkflowDetail({
          workflowsDir: resolveConfig(params).workflowsDir,
          workflowId,
        }),
      });
    } catch (error) {
      respond(false, { error: errorMessage(error) });
    }
  });

  registerReadMethod(api, "comfyui.runs.list", async ({ params, respond }) => {
    try {
      const config = resolveConfig(params);
      respond(true, {
        runs: await listWorkflowRunRecords({
          workflowsDir: config.workflowsDir,
          workflowId: readStringParam(params, "workflowId"),
          limit: readLimit(params, 50),
        }),
      });
    } catch (error) {
      respond(false, { error: errorMessage(error) });
    }
  });

  registerReadMethod(api, "comfyui.outputs.list", async ({ params, respond }) => {
    try {
      const config = resolveConfig(params);
      respond(true, {
        outputs: await listWorkflowOutputSummaries({
          workflowsDir: config.workflowsDir,
          workflowId: readStringParam(params, "workflowId"),
          limit: readLimit(params, 50),
        }),
      });
    } catch (error) {
      respond(false, { error: errorMessage(error) });
    }
  });

  registerReadMethod(api, "comfyui.workflow.validate", async ({ params, respond }) => {
    try {
      const workflowId = readStringParam(params, "workflowId");
      if (!workflowId) {
        respond(false, { error: "workflowId required" });
        return;
      }
      respond(true, await executeComfyUiTool(api, { ...params, action: "validate", workflowId }));
    } catch (error) {
      respond(false, { error: errorMessage(error) });
    }
  });

  api.registerGatewayMethod(
    "comfyui.workflow.run",
    async ({ params, respond }: GatewayRequestHandlerOptions) => {
      try {
        if (params.confirmed !== true) {
          respond(false, { error: "confirmed true required before running a ComfyUI workflow" });
          return;
        }
        const workflowId = readStringParam(params, "workflowId");
        if (!workflowId) {
          respond(false, { error: "workflowId required" });
          return;
        }
        respond(
          true,
          await executeComfyUiTool(api, {
            ...params,
            action: "run",
            workflowId,
            waitForCompletion: params.waitForCompletion === true,
            downloadOutputs: params.downloadOutputs === true,
          }),
        );
      } catch (error) {
        respond(false, { error: errorMessage(error) });
      }
    },
    { scope: "operator.write" },
  );
}
