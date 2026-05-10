import { runNativePluginOperation } from "crawclaw/plugin-sdk/native-plugin-runtime";
import type { CrawClawPluginApi, GatewayRequestHandlerOptions } from "../runtime-api.js";

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

async function runComfyUiNative<T>(
  api: CrawClawPluginApi,
  operation: string,
  params: Record<string, unknown>,
): Promise<T> {
  const { workspaceDir } = resolveControlPlaneContext(api, params);
  return await runNativePluginOperation<T>({
    plugin: "comfyui",
    operation,
    input: {
      params,
      pluginConfig: api.pluginConfig ?? {},
      workspaceDir,
    },
    timeoutMs:
      typeof params.runTimeoutMs === "number"
        ? params.runTimeoutMs
        : typeof params.requestTimeoutMs === "number"
          ? params.requestTimeoutMs
          : undefined,
  });
}

function registerReadMethod(
  api: CrawClawPluginApi,
  method: string,
  handler: (opts: GatewayRequestHandlerOptions) => Promise<void> | void,
): void {
  api.registerGatewayMethod(method, handler, { scope: "operator.read" });
}

export function registerComfyUiGatewayMethods(api: CrawClawPluginApi): void {
  registerReadMethod(api, "comfyui.status", async ({ params, respond }) => {
    try {
      respond(true, await runComfyUiNative(api, "status", params));
    } catch (error) {
      respond(false, { error: errorMessage(error) });
    }
  });

  registerReadMethod(api, "comfyui.workflows.list", async ({ params, respond }) => {
    try {
      respond(
        true,
        await runComfyUiNative(api, "workflows-list", { ...params, limit: readLimit(params, 100) }),
      );
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
      respond(true, await runComfyUiNative(api, "workflow-get", { ...params, workflowId }));
    } catch (error) {
      respond(false, { error: errorMessage(error) });
    }
  });

  registerReadMethod(api, "comfyui.runs.list", async ({ params, respond }) => {
    try {
      respond(
        true,
        await runComfyUiNative(api, "runs-list", { ...params, limit: readLimit(params, 50) }),
      );
    } catch (error) {
      respond(false, { error: errorMessage(error) });
    }
  });

  registerReadMethod(api, "comfyui.outputs.list", async ({ params, respond }) => {
    try {
      respond(
        true,
        await runComfyUiNative(api, "outputs-list", { ...params, limit: readLimit(params, 50) }),
      );
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
      respond(
        true,
        await runComfyUiNative(api, "tool", { ...params, action: "validate", workflowId }),
      );
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
          await runComfyUiNative(api, "tool", {
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
