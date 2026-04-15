import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import { createScraplingWebFetchProvider } from "./src/provider.js";
import { createScraplingFetchPluginService } from "./src/service.js";

export default definePluginEntry({
  id: "scrapling-fetch",
  name: "Scrapling Fetch Plugin",
  description: "Bundled Scrapling web-fetch provider backed by a local Python/HTTP sidecar service",
  register(api) {
    api.registerWebFetchProvider(createScraplingWebFetchProvider());
    api.registerService(createScraplingFetchPluginService());
  },
});
