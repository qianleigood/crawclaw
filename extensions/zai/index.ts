import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import { zaiMediaUnderstandingProvider } from "./media-understanding-provider.js";

export default definePluginEntry({
  id: "zai",
  name: "Z.AI Provider",
  description: "Bundled Z.AI non-LLM provider capabilities",
  register(api) {
    api.registerMediaUnderstandingProvider(zaiMediaUnderstandingProvider);
  },
});
