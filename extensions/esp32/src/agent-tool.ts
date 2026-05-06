import { Type } from "@sinclair/typebox";
import type { CrawClawPluginApi, CrawClawPluginToolFactory } from "../api.js";
import { readEsp32PluginConfigFromCrawClawConfig } from "./config.js";
import { getEsp32Service } from "./runtime.js";

const Esp32CallToolSchema = Type.Object({
  deviceId: Type.String({ description: "Paired ESP32-S3-BOX-3 device id." }),
  toolName: Type.String({ description: "Device tool name, for example display.set." }),
  args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export function createEsp32CallTool(api: CrawClawPluginApi): CrawClawPluginToolFactory {
  return (ctx) => {
    const cfg = ctx.runtimeConfig ?? ctx.config ?? api.config;
    const config = readEsp32PluginConfigFromCrawClawConfig(cfg);
    return {
      label: "ESP32 Tool",
      name: "esp32_call_tool",
      displaySummary: "Call an allowlisted ESP32-S3-BOX-3 device tool.",
      description:
        "Call a low-risk allowlisted tool exposed by a paired ESP32-S3-BOX-3 device. Use this for display, LED, audio, volume, mute, and sensor reads only.",
      parameters: Esp32CallToolSchema,
      ownerOnly: true,
      execute: async (_toolCallId, args) => {
        const service = getEsp32Service();
        if (!service) {
          throw new Error("ESP32 channel service is not running");
        }
        const params = args as {
          deviceId: string;
          toolName: string;
          args?: Record<string, unknown>;
        };
        const result = await service.callDeviceTool({
          deviceId: params.deviceId,
          toolName: params.toolName,
          args: params.args ?? {},
          allowlist: config.tools.allowlist,
          highRiskRequiresApproval: config.tools.highRiskRequiresApproval,
          timeoutMs: 5_000,
        });
        return {
          content: [
            {
              type: "text",
              text: result.ok
                ? `ESP32 tool ${params.toolName} completed.`
                : `ESP32 tool ${params.toolName} failed: ${result.error}`,
            },
          ],
          details: result,
        };
      },
    };
  };
}
