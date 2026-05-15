import {
  definePluginEntry,
  type CrawClawPluginApi,
  type CrawClawPluginToolFactory,
} from "./runtime-api.js";
import { createTurixDesktopTool, TURIX_DESKTOP_TOOL_NAME } from "./src/tool.js";

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
  },
});
