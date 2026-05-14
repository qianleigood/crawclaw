import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { nativeBundledSpeechProvidersForPlugin } from "./native-bundled-speech-providers.js";

const runCrawClawRuntimeTool = vi.hoisted(() =>
  vi.fn(async (tool: string) =>
    tool === "native_plugin_invoke"
      ? {
          audioBase64: Buffer.from("voice").toString("base64"),
          outputFormat: "wav",
        }
      : { status: "external" },
  ),
);

vi.mock("../agents/runtime-tools/native.js", () => ({
  runCrawClawRuntimeTool,
}));

describe("native bundled speech providers", () => {
  beforeEach(() => {
    runCrawClawRuntimeTool.mockClear();
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
    expect(runCrawClawRuntimeTool).toHaveBeenNthCalledWith(
      1,
      "native_plugin_service_start",
      {
        pluginId: "qwen3-tts",
        serviceId: "qwen3-tts-daemon",
        input: {
          providerConfig,
          pluginRoot: "/tmp/qwen3-tts",
        },
      },
      { timeoutMs: 30_000 },
    );
    expect(runCrawClawRuntimeTool).toHaveBeenNthCalledWith(
      2,
      "native_plugin_invoke",
      {
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
      { timeoutMs: 30_000 },
    );
  });
});
