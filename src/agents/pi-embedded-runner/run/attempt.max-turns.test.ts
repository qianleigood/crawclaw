import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDefaultEmbeddedSession,
  createSubscriptionMock,
  getHoisted,
  resetEmbeddedAttemptHarness,
  testModel,
} from "./attempt.spawn-workspace.test-support.js";
import { runEmbeddedAttempt } from "./attempt.js";

const hoisted = getHoisted();

describe("runEmbeddedAttempt maxTurns", () => {
  const tempPaths: string[] = [];

  beforeEach(() => {
    resetEmbeddedAttemptHarness({
      subscribeImpl: () => createSubscriptionMock(),
    });
  });

  afterEach(async () => {
    while (tempPaths.length > 0) {
      const target = tempPaths.pop();
      if (target) {
        await fs.rm(target, { recursive: true, force: true });
      }
    }
  });

  it("aborts a run when it exceeds the configured maxTurns", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-max-turns-workspace-"));
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-max-turns-agent-"));
    const sessionFile = path.join(workspaceDir, "session.jsonl");
    tempPaths.push(workspaceDir, agentDir);
    await fs.writeFile(sessionFile, "", "utf8");

    let aborted = false;
    const session = createDefaultEmbeddedSession({
      prompt: async (currentSession) => {
        for (let turn = 0; turn < 6; turn += 1) {
          currentSession.subscriptions?.forEach((listener) => listener({ type: "turn_start" }));
          if (aborted) {
            return;
          }
        }
      },
    });
    session.abort = async () => {
      aborted = true;
    };

    hoisted.createAgentSessionMock.mockResolvedValue({
      session,
    });

    const result = await runEmbeddedAttempt({
      sessionId: "embedded-session",
      sessionKey: "agent:main:main",
      sessionFile,
      workspaceDir,
      agentDir,
      config: {},
      prompt: "extract durable memory",
      timeoutMs: 30_000,
      maxTurns: 5,
      runId: "run-max-turns",
      provider: "openai",
      modelId: "gpt-test",
      model: testModel,
      authStorage: {} as never,
      modelRegistry: {} as never,
      thinkLevel: "off",
      senderIsOwner: true,
      disableMessageTool: true,
    });

    expect(result.aborted).toBe(true);
  });
});
