import { runNativePluginOperation } from "crawclaw/plugin-sdk/native-plugin-runtime";
import { jsonResult, type AnyAgentTool, type CrawClawPluginToolContext } from "../runtime-api.js";

type ToolDeps = {
  pluginConfig?: Record<string, unknown>;
};

const ActionSchema = {
  type: "object",
  properties: {
    action: { type: "string" },
    refresh: { type: "boolean" },
    query: { type: "string" },
    mediaKind: { type: "string" },
    intent: { type: "string" },
    limit: { type: "number" },
    goal: { type: "string" },
    candidateIr: {},
    inputs: { type: "object" },
    save: { type: "boolean" },
    workflowId: { type: "string" },
    ir: {},
    diagnostics: { type: "array" },
    waitForCompletion: { type: "boolean" },
    downloadOutputs: { type: "boolean" },
    promptId: { type: "string" },
    download: { type: "boolean" },
    prompt: {},
  },
  required: ["action"],
  additionalProperties: true,
};

function readTimeoutMs(args: Record<string, unknown>, pluginConfig?: Record<string, unknown>) {
  if (typeof args.runTimeoutMs === "number" && args.runTimeoutMs > 0) {
    return args.runTimeoutMs;
  }
  if (typeof args.requestTimeoutMs === "number" && args.requestTimeoutMs > 0) {
    return args.requestTimeoutMs;
  }
  if (typeof pluginConfig?.runTimeoutMs === "number" && pluginConfig.runTimeoutMs > 0) {
    return pluginConfig.runTimeoutMs;
  }
  if (typeof pluginConfig?.requestTimeoutMs === "number" && pluginConfig.requestTimeoutMs > 0) {
    return pluginConfig.requestTimeoutMs;
  }
  return 900_000;
}

export function createComfyUiWorkflowTool(
  ctx: CrawClawPluginToolContext = {},
  deps?: ToolDeps,
): AnyAgentTool {
  return {
    label: "ComfyUI Workflow",
    name: "comfyui_workflow",
    description:
      "Inspect local ComfyUI nodes, create validated image/video workflow IR, run approved prompts, and download outputs.",
    parameters: ActionSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const result = await runNativePluginOperation<Record<string, unknown>>({
        plugin: "comfyui",
        operation: "tool",
        input: {
          params,
          pluginConfig: deps?.pluginConfig ?? {},
          workspaceDir: ctx.workspaceDir,
        },
        timeoutMs: readTimeoutMs(params, deps?.pluginConfig),
      });
      return jsonResult(result);
    },
  };
}
