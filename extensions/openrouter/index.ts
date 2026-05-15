import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import { openrouterMediaUnderstandingProvider } from "./media-understanding-provider.js";

export default definePluginEntry({
  id: "openrouter",
  name: "OpenRouter Provider",
  description: "Bundled OpenRouter non-LLM provider capabilities",
  register(api) {
    api.registerMediaUnderstandingProvider(openrouterMediaUnderstandingProvider);
  },
});
