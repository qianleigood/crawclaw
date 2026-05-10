import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { withEnvAsync } from "../test-utils/env.js";
import { buildProviderRegistry, runCapability } from "./runner.js";
import { withAudioFixture } from "./runner.test-utils.js";

function createOpenAiAudioProvider(
  transcribeAudio: (req: { model?: string }) => Promise<{ text: string; model: string }>,
) {
  return buildProviderRegistry({
    openai: {
      id: "openai",
      capabilities: ["audio"],
      transcribeAudio,
    },
  });
}

function createOpenAiAudioCfg(extra?: Partial<CrawClawConfig>): CrawClawConfig {
  return {
    models: {
      providers: {
        openai: {
          apiKey: "test-key",
          models: [],
        },
      },
    },
    ...extra,
  } as unknown as CrawClawConfig;
}

async function runAutoAudioCase(params: {
  transcribeAudio: (req: { model?: string }) => Promise<{ text: string; model: string }>;
  cfgExtra?: Partial<CrawClawConfig>;
}) {
  let runResult: Awaited<ReturnType<typeof runCapability>> | undefined;
  await withAudioFixture("crawclaw-auto-audio", async ({ ctx, media, cache }) => {
    const providerRegistry = createOpenAiAudioProvider(params.transcribeAudio);
    const cfg = createOpenAiAudioCfg(params.cfgExtra);
    runResult = await runCapability({
      capability: "audio",
      cfg,
      ctx,
      attachments: cache,
      media,
      providerRegistry,
    });
  });
  if (!runResult) {
    throw new Error("Expected auto audio case result");
  }
  return runResult;
}

describe("runCapability auto audio entries", () => {
  it("does not auto-enable remote audio transcription from provider keys", async () => {
    const transcribeAudio = vi.fn(async (req: { model?: string }) => ({
      text: "ok",
      model: req.model ?? "unknown",
    }));
    const result = await runAutoAudioCase({
      transcribeAudio,
    });

    expect(result.outputs).toHaveLength(0);
    expect(result.decision.outcome).toBe("skipped");
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it.runIf(process.platform !== "win32")(
    "prefers the managed local MLX Whisper runtime when installed",
    async () => {
      const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-audio-runtime-"));
      const isolatedAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-audio-agent-"));
      const pythonPath = path.join(
        runtimeRoot,
        "node-24",
        "skill-openai-whisper",
        "venv",
        "bin",
        "python",
      );
      try {
        await fs.mkdir(path.dirname(pythonPath), { recursive: true });
        await fs.writeFile(pythonPath, "#!/bin/sh\necho local-whisper-transcript\n");
        await fs.chmod(pythonPath, 0o755);
        await withEnvAsync(
          {
            CRAWCLAW_PLUGIN_RUNTIMES_DIR: runtimeRoot,
            CRAWCLAW_RUNTIME_NODE_VERSION: "24.0.0",
            CRAWCLAW_AGENT_DIR: isolatedAgentDir,
            PI_CODING_AGENT_DIR: isolatedAgentDir,
            PATH: "",
          },
          async () => {
            await withAudioFixture(
              "crawclaw-auto-audio-local-whisper",
              async ({ ctx, media, cache }) => {
                const providerRegistry = createOpenAiAudioProvider(async () => ({
                  text: "remote",
                  model: "gpt-4o-mini-transcribe",
                }));
                const cfg = createOpenAiAudioCfg();

                const result = await runCapability({
                  capability: "audio",
                  cfg,
                  ctx,
                  attachments: cache,
                  media,
                  providerRegistry,
                });

                expect(result.decision.outcome).toBe("success");
                expect(result.outputs[0]?.text).toBe("local-whisper-transcript");
                expect(result.outputs[0]?.provider).toBe("cli");
              },
            );
          },
        );
      } finally {
        await fs.rm(runtimeRoot, { recursive: true, force: true });
        await fs.rm(isolatedAgentDir, { recursive: true, force: true });
      }
    },
  );

  it("skips auto audio when disabled", async () => {
    const result = await runAutoAudioCase({
      transcribeAudio: async () => ({
        text: "ok",
        model: "whisper-1",
      }),
      cfgExtra: {
        tools: {
          media: {
            audio: {
              enabled: false,
            },
          },
        },
      },
    });
    expect(result.outputs).toHaveLength(0);
    expect(result.decision.outcome).toBe("disabled");
  });

  it("prefers explicitly configured audio model entries", async () => {
    let seenModel: string | undefined;
    const result = await runAutoAudioCase({
      transcribeAudio: async (req) => {
        seenModel = req.model;
        return { text: "ok", model: req.model ?? "unknown" };
      },
      cfgExtra: {
        tools: {
          media: {
            audio: {
              models: [{ provider: "openai", model: "whisper-1" }],
            },
          },
        },
      },
    });

    expect(result.outputs[0]?.text).toBe("ok");
    expect(seenModel).toBe("whisper-1");
  });

  it("does not auto-enable Mistral audio transcription from provider keys", async () => {
    const isolatedAgentDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-audio-agent-"));
    let runResult: Awaited<ReturnType<typeof runCapability>> | undefined;
    const mistralTranscribeAudio = vi.fn(async (req: { model?: string }) => ({
      text: "mistral",
      model: req.model ?? "unknown",
    }));
    try {
      await withEnvAsync(
        {
          OPENAI_API_KEY: undefined,
          GROQ_API_KEY: undefined,
          DEEPGRAM_API_KEY: undefined,
          GEMINI_API_KEY: undefined,
          GOOGLE_API_KEY: undefined,
          MISTRAL_API_KEY: "mistral-test-key", // pragma: allowlist secret
          CRAWCLAW_AGENT_DIR: isolatedAgentDir,
          PI_CODING_AGENT_DIR: isolatedAgentDir,
        },
        async () => {
          await withAudioFixture("crawclaw-auto-audio-mistral", async ({ ctx, media, cache }) => {
            const providerRegistry = buildProviderRegistry({
              openai: {
                id: "openai",
                capabilities: ["audio"],
                transcribeAudio: async () => ({
                  text: "openai",
                  model: "gpt-4o-mini-transcribe",
                }),
              },
              mistral: {
                id: "mistral",
                capabilities: ["audio"],
                transcribeAudio: mistralTranscribeAudio,
              },
            });
            const cfg = {
              models: {
                providers: {
                  mistral: {
                    apiKey: "mistral-test-key", // pragma: allowlist secret
                    models: [],
                  },
                },
              },
              tools: {
                media: {
                  audio: {
                    enabled: true,
                  },
                },
              },
            } as unknown as CrawClawConfig;

            runResult = await runCapability({
              capability: "audio",
              cfg,
              ctx,
              attachments: cache,
              media,
              providerRegistry,
            });
          });
        },
      );
    } finally {
      await fs.rm(isolatedAgentDir, { recursive: true, force: true });
    }
    if (!runResult) {
      throw new Error("Expected auto audio mistral result");
    }
    expect(runResult.decision.outcome).toBe("skipped");
    expect(runResult.outputs).toHaveLength(0);
    expect(mistralTranscribeAudio).not.toHaveBeenCalled();
  });
});
