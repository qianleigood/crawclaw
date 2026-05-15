import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import { buildOpenAICodexCliBackend } from "./cli-backend.js";
import {
  openaiCodexMediaUnderstandingProvider,
  openaiMediaUnderstandingProvider,
} from "./media-understanding-provider.js";

export default definePluginEntry({
  id: "openai",
  name: "OpenAI Provider",
  description: "Bundled OpenAI non-LLM provider capabilities",
  register(api) {
    api.registerCliBackend(buildOpenAICodexCliBackend());
    api.registerMediaUnderstandingProvider(openaiMediaUnderstandingProvider);
    api.registerMediaUnderstandingProvider(openaiCodexMediaUnderstandingProvider);
  },
});
