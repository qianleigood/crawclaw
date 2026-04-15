import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import {
  startManagedOpenWebSearchDaemonService,
  stopManagedOpenWebSearchDaemonService,
} from "./src/open-websearch-daemon.js";
import { createOpenWebSearchProvider } from "./src/open-websearch-provider.js";

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
