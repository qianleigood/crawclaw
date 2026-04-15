import {
  createBrowserTool,
  definePluginEntry,
  type CrawClawPluginToolContext,
  type CrawClawPluginToolFactory,
} from "./runtime-api.js";

export default definePluginEntry({
  id: "browser",
  name: "Browser",
  description: "Default browser tool plugin",
  register(api) {
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
