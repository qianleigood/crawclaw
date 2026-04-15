import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import type {
  AnyAgentTool,
  CrawClawPluginApi,
  CrawClawPluginToolFactory,
} from "./runtime-api.js";
import { createLobsterTool } from "./src/lobster-tool.js";

export default definePluginEntry({
  id: "lobster",
  name: "Lobster",
  description: "Optional local shell helper tools",
  register(api: CrawClawPluginApi) {
    api.registerTool(
      ((ctx) => {
        if (ctx.sandboxed) {
          return null;
        }
        return createLobsterTool(api) as AnyAgentTool;
      }) as CrawClawPluginToolFactory,
      { optional: true },
    );
  },
});
