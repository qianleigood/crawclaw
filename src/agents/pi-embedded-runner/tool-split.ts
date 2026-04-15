import type { AgentTool } from "@mariozechner/pi-agent-core";
import { toToolDefinitions } from "../pi-tool-definition-adapter.js";

// Default path keeps tools in `customTools` so policy filtering, sandbox integration,
// and extended toolset stay consistent across providers. Some narrow flows still need
// native provider tools so the model receives a real `tools` payload.
type AnyAgentTool = AgentTool;

export function splitSdkTools(options: {
  tools: AnyAgentTool[];
  sandboxEnabled: boolean;
  preferBuiltInToolNames?: Set<string>;
}): {
  builtInTools: AnyAgentTool[];
  customTools: ReturnType<typeof toToolDefinitions>;
} {
  const { tools, preferBuiltInToolNames } = options;
  const builtInTools =
    preferBuiltInToolNames && preferBuiltInToolNames.size > 0
      ? tools.filter((tool) => preferBuiltInToolNames.has(tool.name))
      : [];
  const customToolsSource =
    builtInTools.length > 0
      ? tools.filter((tool) => !preferBuiltInToolNames?.has(tool.name))
      : tools;
  return {
    builtInTools,
    customTools: toToolDefinitions(customToolsSource),
  };
}
