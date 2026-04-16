import {
  createOpenWebSearchProvider,
  startManagedOpenWebSearchDaemonService,
  stopManagedOpenWebSearchDaemonService,
} from "crawclaw/plugin-sdk/open-websearch-runtime";
import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "open-websearch",
  name: "Open-WebSearch Plugin",
  description: "Bundled provider for CrawClaw-managed open-websearch web search",
  register(api) {
    api.registerWebSearchProvider(createOpenWebSearchProvider());
    api.registerService({
      id: "open-websearch-daemon",
      start: async (ctx) => {
        await startManagedOpenWebSearchDaemonService({
          config: ctx.config,
        });
      },
      stop: async (ctx) => {
        await stopManagedOpenWebSearchDaemonService({
          config: ctx.config,
        });
      },
    });
  },
});
