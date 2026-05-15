import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import {
  minimaxMediaUnderstandingProvider,
  minimaxPortalMediaUnderstandingProvider,
} from "./media-understanding-provider.js";

export default definePluginEntry({
  id: "minimax",
  name: "MiniMax Provider",
  description: "Bundled MiniMax non-LLM provider capabilities",
  register(api) {
    api.registerMediaUnderstandingProvider(minimaxMediaUnderstandingProvider);
    api.registerMediaUnderstandingProvider(minimaxPortalMediaUnderstandingProvider);
  },
});
