import { definePluginEntry } from "crawclaw/plugin-sdk/plugin-entry";
import { buildQwen3TtsSpeechProvider } from "./speech-provider.js";

export default definePluginEntry({
  id: "qwen3-tts",
  name: "Qwen3-TTS",
  description: "Bundled local Qwen3-TTS speech provider",
  register(api) {
    api.registerSpeechProvider(buildQwen3TtsSpeechProvider());
  },
});
