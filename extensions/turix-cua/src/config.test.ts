import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTurixConfig } from "./config.js";

describe("resolveTurixConfig", () => {
  it("defaults to a managed runtime under the CrawClaw state directory", () => {
    const config = resolveTurixConfig({
      workspaceDir: "/tmp/workspace",
      pluginConfig: {},
      env: { CRAWCLAW_STATE_DIR: "/tmp/crawclaw-state" },
    });

    expect(config.runtime.mode).toBe("managed");
    expect(config.runtime.projectDir).toBe(
      path.join("/tmp/crawclaw-state", "runtimes", "turix-cua", "source"),
    );
    expect(config.runtime.pythonPath).toBe(
      path.join("/tmp/crawclaw-state", "runtimes", "turix-cua", "venv", "bin", "python"),
    );
    expect(config.outputRoot).toBe(path.join("/tmp/crawclaw-state", "turix-cua"));
    expect(config.defaultMaxSteps).toBe(40);
    expect(config.defaultTimeoutMs).toBe(600_000);
    expect(config.allowRemoteRequests).toBe(false);
    expect(config.stripReasoningTags).toBe(true);
  });

  it("resolves external runtime paths relative to the workspace", () => {
    const config = resolveTurixConfig({
      workspaceDir: "/tmp/workspace",
      pluginConfig: {
        runtime: {
          mode: "external",
          projectDir: "vendor/TuriX-CUA",
          pythonPath: ".venv/bin/python",
        },
      },
      env: { CRAWCLAW_STATE_DIR: "/tmp/crawclaw-state" },
    });

    expect(config.runtime).toMatchObject({
      mode: "external",
      projectDir: path.join("/tmp/workspace", "vendor/TuriX-CUA"),
      pythonPath: path.join("/tmp/workspace", ".venv/bin/python"),
    });
  });

  it("reads model roles without writing API keys into the resolved config", () => {
    const config = resolveTurixConfig({
      workspaceDir: "/tmp/workspace",
      pluginConfig: {
        models: {
          brain: {
            provider: "turix",
            modelName: "turix-brain",
            baseUrl: "https://turixapi.io/v1",
            apiKeyEnv: "TURIX_API_KEY",
          },
        },
      },
      env: { CRAWCLAW_STATE_DIR: "/tmp/crawclaw-state", TURIX_API_KEY: "secret" },
    });

    expect(config.models.brain).toEqual({
      provider: "turix",
      modelName: "turix-brain",
      baseUrl: "https://turixapi.io/v1",
      apiKeyEnv: "TURIX_API_KEY",
    });
    expect(JSON.stringify(config)).not.toContain("secret");
  });

  it("can disable reasoning tag stripping for provider-compatible runtimes", () => {
    const config = resolveTurixConfig({
      workspaceDir: "/tmp/workspace",
      pluginConfig: {
        stripReasoningTags: false,
      },
      env: { CRAWCLAW_STATE_DIR: "/tmp/crawclaw-state" },
    });

    expect(config.stripReasoningTags).toBe(false);
  });
});
