import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TurixResolvedConfig } from "./config.js";
import {
  buildTurixChildEnv,
  buildTurixMainConfig,
  summarizeTurixInternalFailure,
} from "./runner.js";

function baseConfig(): TurixResolvedConfig {
  return {
    runtime: {
      mode: "external",
      projectDir: "/tmp/TuriX-CUA",
      pythonPath: "/tmp/TuriX-CUA/.venv/bin/python",
    },
    outputRoot: "/tmp/crawclaw-state/turix-cua",
    defaultMaxSteps: 40,
    defaultTimeoutMs: 600_000,
    retainRunsDays: 7,
    allowRemoteRequests: false,
    stripReasoningTags: true,
    usePlan: true,
    useSkills: false,
    maxActionsPerStep: 5,
    forceStopHotkey: "command+shift+2",
    models: {
      brain: {
        provider: "turix",
        modelName: "turix-brain",
        baseUrl: "https://turixapi.io/v1",
        apiKeyEnv: "TURIX_API_KEY",
      },
      actor: {
        provider: "turix",
        modelName: "turix-actor",
        baseUrl: "https://turixapi.io/v1",
        apiKeyEnv: "TURIX_API_KEY",
      },
      planner: {
        provider: "turix",
        modelName: "turix-brain",
        baseUrl: "https://turixapi.io/v1",
        apiKeyEnv: "TURIX_API_KEY",
      },
      memory: {
        provider: "turix",
        modelName: "turix-brain",
        baseUrl: "https://turixapi.io/v1",
        apiKeyEnv: "TURIX_API_KEY",
      },
    },
  };
}

describe("buildTurixMainConfig", () => {
  it("writes a run-scoped TuriX config without embedding provider secrets", () => {
    const mainConfig = buildTurixMainConfig({
      config: baseConfig(),
      request: {
        task: "Open Calculator and compute 2+2",
        runId: "run-1",
        runDir: "/tmp/crawclaw-state/turix-cua/runs/run-1",
        maxSteps: 8,
      },
    });

    expect(mainConfig.output_dir).toBe("/tmp/crawclaw-state/turix-cua/runs/run-1");
    expect(mainConfig.brain_llm).toMatchObject({
      provider: "turix",
      model_name: "turix-brain",
      base_url: "https://turixapi.io/v1",
    });
    expect(mainConfig.brain_llm).not.toHaveProperty("api_key");
    expect(mainConfig.agent).toMatchObject({
      task: "Open Calculator and compute 2+2",
      max_steps: 8,
      use_plan: true,
      use_skills: false,
      agent_id: "run-1",
    });
    expect(mainConfig.agent.save_brain_conversation_path).toBe(
      path.join("logs", "brain_llm_interactions.log"),
    );
  });
});

describe("buildTurixChildEnv", () => {
  it("maps the configured API key env var to TuriX's API_KEY fallback", () => {
    const env = buildTurixChildEnv({
      config: baseConfig(),
      baseEnv: { TURIX_API_KEY: "secret", OTHER: "value" },
    });

    expect(env.API_KEY).toBe("secret");
    expect(env.OPENAI_API_KEY).toBe("secret");
    expect(env.TURIX_API_KEY).toBe("secret");
  });

  it("does not override the generated run-scoped output_dir", () => {
    const env = buildTurixChildEnv({
      config: baseConfig(),
      baseEnv: {},
    });

    expect(env.TURIX_OUTPUT_DIR).toBeUndefined();
  });

  it("enables the reasoning tag stripping shim for TuriX child processes", () => {
    const config = baseConfig();
    for (const role of ["brain", "actor", "planner", "memory"] as const) {
      config.models[role] = {
        provider: "openai-compatible",
        modelName: "reasoning-model",
        baseUrl: "https://models.example.test/v1",
        apiKeyEnv: "REASONING_MODEL_API_KEY",
      };
    }

    const env = buildTurixChildEnv({
      config,
      baseEnv: { REASONING_MODEL_API_KEY: "secret", PYTHONPATH: "/existing/pythonpath" },
      shimDir: "/tmp/crawclaw-turix-shim",
    });

    expect(env.CRAWCLAW_TURIX_STRIP_REASONING_TAGS).toBe("1");
    expect(env.PYTHONPATH).toBe(
      ["/tmp/crawclaw-turix-shim", "/existing/pythonpath"].join(path.delimiter),
    );
  });

  it("does not enable reasoning tag stripping when explicitly disabled", () => {
    const config = { ...baseConfig(), stripReasoningTags: false };

    const env = buildTurixChildEnv({
      config,
      baseEnv: { TURIX_API_KEY: "secret" },
      shimDir: "/tmp/crawclaw-turix-shim",
    });

    expect(env.CRAWCLAW_TURIX_STRIP_REASONING_TAGS).toBeUndefined();
    expect(env.PYTHONPATH).toBeUndefined();
  });
});

describe("summarizeTurixInternalFailure", () => {
  it("detects TuriX task failures even when the process exits cleanly", () => {
    expect(
      summarizeTurixInternalFailure(
        [
          "2026-04-28 16:20:49,271 - src.agent.service - INFO - 📍 Step 1",
          "2026-04-28 16:21:07,162 - src.agent.service - INFO - ❌ Failed to complete task in maximum steps",
        ].join("\n"),
      ),
    ).toContain("Failed to complete task in maximum steps");
  });

  it("does not fail a run when a later success marker is present", () => {
    expect(
      summarizeTurixInternalFailure(
        [
          "2026-04-28 16:21:05,160 - src.agent.service - ERROR - Unexpected error in brain_step",
          "2026-04-28 16:21:07,162 - src.agent.service - INFO - ✅ Task completed successfully",
        ].join("\n"),
      ),
    ).toBeUndefined();
  });
});
