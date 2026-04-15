import {
  createBrowserTool,
  definePluginEntry,
  type CrawClawPluginToolContext,
  type CrawClawPluginToolFactory,
} from "./runtime-api.js";
import {
  ensureManagedPinchTabService,
  stopManagedPinchTabService,
} from "./src/pinchtab/pinchtab-managed-service.js";

export default definePluginEntry({
  id: "browser",
  name: "Browser",
  description: "Default browser tool plugin",
  register(api) {
    api.registerService({
      id: "browser-pinchtab-runtime",
      start: async (ctx) => {
        await ensureManagedPinchTabService({ config: ctx.config, logger: ctx.logger });
      },
      stop: async () => {
        await stopManagedPinchTabService();
      },
    });
    api.registerTool(((ctx: CrawClawPluginToolContext) =>
      createBrowserTool({
        sandboxBridgeUrl: ctx.browser?.sandboxBridgeUrl,
        sandboxCdpUrl: ctx.browser?.sandboxCdpUrl,
        sandboxPinchTabUrl: ctx.browser?.sandboxPinchTabUrl,
        allowHostControl: ctx.browser?.allowHostControl,
        agentSessionKey: ctx.sessionKey,
      })) as CrawClawPluginToolFactory);
  },
});
