import {
  definePluginEntry,
  type CrawClawPluginApi,
  type CrawClawPluginToolFactory,
} from "./runtime-api.js";
import { createTurixDesktopTool, TURIX_DESKTOP_TOOL_NAME } from "./src/tool.js";

function isTurixRunRequest(event: unknown): boolean {
  if (!event || typeof event !== "object") {
    return false;
  }
  const record = event as Record<string, unknown>;
  if (record.toolName !== TURIX_DESKTOP_TOOL_NAME) {
    return false;
  }
  const params = record.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return true;
  }
  return (params as Record<string, unknown>).mode !== "plan";
}

export default definePluginEntry({
  id: "turix-cua",
  name: "TuriX CUA",
  description: "Optional high-risk desktop automation through a local TuriX-CUA worker.",
  register(api: CrawClawPluginApi) {
    api.registerTool(
      ((ctx) =>
        createTurixDesktopTool(ctx, {
          pluginConfig: api.pluginConfig,
        })) as CrawClawPluginToolFactory,
      { name: TURIX_DESKTOP_TOOL_NAME, optional: true },
    );
    api.on(
      "before_tool_call",
      (event) => {
        if (!isTurixRunRequest(event)) {
          return undefined;
        }
        return {
          requireApproval: {
            title: "Run desktop automation with TuriX",
            description:
              "Allow CrawClaw to start a local TuriX-CUA worker that can see and control this Mac desktop. Screenshots may be sent to the configured TuriX model provider.",
            severity: "critical",
            timeoutBehavior: "deny",
          },
        };
      },
      { priority: 0 },
    );
  },
});
