import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import { buildGoogleGeminiCliBackend } from "./cli-backend.js";
import { googleMediaUnderstandingProvider } from "./media-understanding-provider.js";
import { createGeminiWebSearchProvider } from "./web-search-provider.js";

export default definePluginEntry({
  id: "google",
  name: "Google Provider",
  description: "Bundled Google non-LLM provider capabilities",
  register(api) {
    api.registerCliBackend(buildGoogleGeminiCliBackend());
    api.registerMediaUnderstandingProvider(googleMediaUnderstandingProvider);
    api.registerWebSearchProvider(createGeminiWebSearchProvider());
  },
});
