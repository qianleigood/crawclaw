import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import { buildAnthropicCliBackend } from "./cli-backend.js";
import { anthropicMediaUnderstandingProvider } from "./media-understanding-provider.js";

export default definePluginEntry({
  id: "anthropic",
  name: "Anthropic Provider",
  description: "Bundled Anthropic non-LLM provider capabilities",
  register(api) {
    api.registerCliBackend(buildAnthropicCliBackend());
    api.registerMediaUnderstandingProvider(anthropicMediaUnderstandingProvider);
  },
});
