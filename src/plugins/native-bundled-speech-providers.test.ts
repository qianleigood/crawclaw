import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { nativeBundledSpeechProvidersForPlugin } from "./native-bundled-speech-providers.js";

const callGateway = vi.hoisted(() =>
  vi.fn(async (request: { method: string }) =>
    request.method === "nativePlugin.invoke"
      ? {
          audioBase64: Buffer.from("voice").toString("base64"),
          outputFormat: "wav",
        }
      : { status: "external" },
  ),
);

vi.mock("../gateway/call.js", () => ({
  callGateway,
}));

describe("native bundled speech providers", () => {
  beforeEach(() => {
    callGateway.mockClear();
  });

  it("routes Qwen3-TTS synthesis through native service lifecycle and invocation", async () => {
    const [provider] = nativeBundledSpeechProvidersForPlugin("qwen3-tts", {
      rootDir: "/tmp/qwen3-tts",
    });
    const providerConfig = provider?.resolveConfig?.({
      cfg: {} as CrawClawConfig,
      rawConfig: {
        providers: {
          "qwen3-tts": {
            enabled: true,
            autoStart: true,
          },
        },
      },
      timeoutMs: 30_000,
    });

    const result = await provider?.synthesize({
      text: "hello",
      cfg: {} as CrawClawConfig,
      providerConfig: providerConfig ?? {},
      target: "audio-file",
      timeoutMs: 30_000,
    });

    expect(result?.audioBuffer.toString("utf8")).toBe("voice");
    expect(callGateway).toHaveBeenNthCalledWith(1, {
      method: "nativePlugin.service.start",
      params: {
        pluginId: "qwen3-tts",
        serviceId: "qwen3-tts-daemon",
        input: {
          providerConfig,
          pluginRoot: "/tmp/qwen3-tts",
        },
      },
      timeoutMs: 30_000,
    });
    expect(callGateway).toHaveBeenNthCalledWith(2, {
      method: "nativePlugin.invoke",
      params: {
        pluginId: "qwen3-tts",
        operation: "synthesize",
        input: {
          text: "hello",
          target: "audio-file",
          responseFormat: "wav",
          agentId: undefined,
          providerConfig,
          providerOverrides: {
            profile: undefined,
            voice: undefined,
            model: undefined,
            language: undefined,
            instructions: undefined,
          },
          pluginRoot: "/tmp/qwen3-tts",
        },
      },
      timeoutMs: 30_000,
    });
  });
});
