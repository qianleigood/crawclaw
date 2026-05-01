import {
  definePluginEntry,
  type CrawClawPluginApi,
  type CrawClawPluginToolFactory,
} from "./runtime-api.js";
import { registerComfyUiGatewayMethods } from "./src/control-plane.js";
import { createComfyUiWorkflowTool } from "./src/tool.js";

function isRunAction(event: unknown): boolean {
  if (!event || typeof event !== "object") {
    return false;
  }
  const record = event as Record<string, unknown>;
  if (record.toolName !== "comfyui_workflow") {
    return false;
  }
  const params = record.params;
  return (
    !!params && typeof params === "object" && (params as Record<string, unknown>).action === "run"
  );
}

export default definePluginEntry({
  id: "comfyui",
  name: "ComfyUI",
  description: "Build, validate, run, and download local ComfyUI workflows.",
  register(api: CrawClawPluginApi) {
    registerComfyUiGatewayMethods(api);
    api.registerTool(
      ((ctx) =>
        createComfyUiWorkflowTool(ctx, {
          pluginConfig: api.pluginConfig,
        })) as CrawClawPluginToolFactory,
      { name: "comfyui_workflow", optional: true },
    );
    api.on(
      "before_tool_call",
      (event) => {
        if (!isRunAction(event)) {
          return undefined;
        }
        return {
          requireApproval: {
            title: "Run ComfyUI workflow",
            description:
              "Submit a generated workflow to the local ComfyUI queue. This may use GPU, disk, and time.",
            severity: "warning",
            timeoutBehavior: "deny",
          },
        };
      },
      { priority: 0 },
    );
  },
});
