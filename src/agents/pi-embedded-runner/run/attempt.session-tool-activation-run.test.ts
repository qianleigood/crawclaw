import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runEmbeddedAttempt } from "./attempt.js";
import {
  createDefaultEmbeddedSession,
  getHoisted,
  resetEmbeddedAttemptHarness,
  testModel,
} from "./attempt.spawn-workspace.test-support.js";

const hoisted = getHoisted();

describe("runEmbeddedAttempt session tool activation", () => {
  const tempPaths: string[] = [];

  beforeEach(() => {
    resetEmbeddedAttemptHarness();
  });

  afterEach(async () => {
    while (tempPaths.length > 0) {
      const target = tempPaths.pop();
      if (target) {
        await fs.rm(target, { recursive: true, force: true });
      }
    }
  });

  it("activates all effective tools for normal runs without toolsAllow", async () => {
    const workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-tool-activation-workspace-"),
    );
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-tool-activation-agent-"));
    const sessionFile = path.join(workspaceDir, "session.jsonl");
    tempPaths.push(workspaceDir, agentDir);
    await fs.writeFile(sessionFile, "", "utf8");

    const effectiveTools = [
      { name: "session_status", execute: vi.fn() },
      { name: "web_fetch", execute: vi.fn() },
    ];
    hoisted.createCrawClawCodingToolsMock.mockReturnValue(effectiveTools);

    const session = createDefaultEmbeddedSession();
    const setTools = vi.fn((tools: typeof effectiveTools) => {
      (session.agent.state as { tools?: typeof effectiveTools }).tools = [...tools];
    });
    (session.agent.state as { tools?: typeof effectiveTools }).tools = [];
    (session.agent as typeof session.agent & { setTools?: typeof setTools }).setTools = setTools;
    hoisted.createAgentSessionMock.mockResolvedValue({ session });

    await runEmbeddedAttempt({
      sessionId: "embedded-session",
      sessionKey: "agent:main:main",
      sessionFile,
      workspaceDir,
      agentDir,
      config: {},
      prompt: "hello",
      timeoutMs: 30_000,
      runId: "run-tool-activation",
      provider: "openai",
      modelId: "gpt-test",
      model: testModel,
      authStorage: {} as never,
      modelRegistry: {} as never,
      thinkLevel: "off",
      senderIsOwner: true,
      disableMessageTool: true,
    });

    expect(setTools).toHaveBeenCalledTimes(1);
    expect(setTools.mock.calls[0]?.[0].map((tool) => tool.name)).toEqual([
      "session_status",
      "web_fetch",
    ]);
  });
});
