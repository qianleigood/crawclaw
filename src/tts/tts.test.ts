import { describe, expect, it } from "vitest";
import * as tts from "./tts.js";

describe("tts runtime facade", () => {
  it("exposes the speech runtime facade functions", () => {
    expect(typeof tts.buildTtsSystemPromptHint).toBe("function");
    expect(typeof tts.textToSpeech).toBe("function");
    expect(typeof tts.textToSpeechTelephony).toBe("function");
  });
});
