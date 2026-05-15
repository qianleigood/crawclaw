import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import { createXaiWebSearchProvider } from "./web-search.js";

export default definePluginEntry({
  id: "xai",
  name: "xAI Provider",
  description: "Bundled xAI web-search capability",
  register(api) {
    api.registerWebSearchProvider(createXaiWebSearchProvider());
  },
});
