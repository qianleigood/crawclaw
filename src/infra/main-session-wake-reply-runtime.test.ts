import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCrawClawRuntimeTool } from "../agents/runtime-tools/native.js";
import type { CrawClawConfig } from "../config/config.js";
import { runMainSessionWakeReply } from "./main-session-wake-reply-runtime.js";

vi.mock("../agents/runtime-tools/native.js", () => ({
  runCrawClawRuntimeTool: vi.fn(),
}));

const runRuntimeTool = vi.mocked(runCrawClawRuntimeTool);

describe("main-session wake reply runtime", () => {
  beforeEach(() => {
    runRuntimeTool.mockReset();
    runRuntimeTool.mockResolvedValue({
      runId: "wake-run",
      sessionKey: "agent:main:gateway:direct:user",
      assistantText: "wake ok",
      events: [
        {
          type: "replyPayload",
          runId: "wake-run",
          payload: { text: "wake ok" },
        },
      ],
    });
  });

  it("runs wake replies through Rust agent.runTurn and forwards heartbeat policy", async () => {
    const cfg = {
      agents: {
        defaults: {
          model: "openai/gpt-5.4",
        },
      },
    } satisfies CrawClawConfig;

    const result = await runMainSessionWakeReply(
      {
        Body: "wake prompt",
        Provider: "system-event",
        From: "user",
        To: "agent:main",
        SessionKey: "agent:main:gateway:direct:user",
        CommandAuthorized: true,
      },
      {
        runId: "wake-run",
        isHeartbeat: true,
        heartbeatModelOverride: "ollama/llama3.2:1b",
        bootstrapContextMode: "lightweight",
        suppressToolErrorWarnings: true,
      },
      cfg,
    );

    expect(result).toEqual({ text: "wake ok" });
    expect(runRuntimeTool).toHaveBeenCalledWith(
      "agent_run_turn",
      expect.objectContaining({
        runId: "wake-run",
        sessionKey: "agent:main:gateway:direct:user",
        model: {
          provider: "ollama",
          model: "llama3.2:1b",
        },
        options: {
          heartbeat: true,
          heartbeatModelOverride: "ollama/llama3.2:1b",
          bootstrapContextMode: "lightweight",
          suppressToolErrorWarnings: true,
        },
      }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });
});
