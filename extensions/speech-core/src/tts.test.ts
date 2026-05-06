import { describe, expect, it } from "vitest";
import { resolveTtsTargetForChannel } from "./tts-target.js";

describe("speech-core TTS target selection", () => {
  it("requests voice-note output for ESP32", () => {
    expect(resolveTtsTargetForChannel("esp32")).toBe("voice-note");
  });
});
