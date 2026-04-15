import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSpecialAgentCacheEnvelope } from "../../special/runtime/cache-safe-params.js";
import {
  cleanupTempPaths,
  createSubscriptionMock,
  createDefaultEmbeddedSession,
  getHoisted,
  getRunEmbeddedAttempt,
  resetEmbeddedAttemptHarness,
  testModel,
} from "./attempt.spawn-workspace.test-support.js";

const hoisted = getHoisted();

describe("runEmbeddedAttempt special inherited prompt envelope", () => {
  const tempPaths: string[] = [];

  beforeEach(() => {
    resetEmbeddedAttemptHarness({
      subscribeImpl: () => createSubscriptionMock(),
    });
  });

  afterEach(async () => {
    await cleanupTempPaths(tempPaths);
  });

  it("uses inherited prompt, tool inventory, thinking config, and fork context messages", async () => {
    const workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-inherited-envelope-workspace-"),
    );
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-inherited-envelope-agent-"));
    const sessionFile = path.join(workspaceDir, "session.jsonl");
    tempPaths.push(workspaceDir, agentDir);
    await fs.writeFile(sessionFile, "", "utf8");

    hoisted.createCrawClawCodingToolsMock.mockImplementation(() => [
      {
        name: "read",
        label: "read",
        description: "Read files",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [] }),
      },
      {
        name: "exec",
        label: "exec",
        description: "Execute commands",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [] }),
      },
    ]);
    hoisted.applyExtraParamsToAgentMock.mockImplementation(
      (
        _agent: unknown,
        _config: unknown,
        _provider: unknown,
        _modelId: unknown,
        streamParams: unknown,
        thinkLevel: unknown,
      ) => ({
        effectiveExtraParams: {
          ...(typeof streamParams === "object" && streamParams ? streamParams : {}),
          forwardedThinkLevel: thinkLevel,
        } as Record<string, unknown>,
      }),
    );

    const session = createDefaultEmbeddedSession({
      prompt: async (currentSession) => {
        currentSession.messages = [
          ...currentSession.messages,
          { role: "assistant", content: "done", timestamp: 2 },
        ];
      },
    });
    hoisted.createAgentSessionMock.mockResolvedValue({
      session,
    });

    const inheritedMessages = [{ role: "user", content: "from parent", timestamp: 1 }];
    const inheritedToolPromptPayload = [{ name: "read" }];
    const inheritedEnvelope = buildSpecialAgentCacheEnvelope({
      systemPromptText: "parent system prompt",
      toolNames: ["read"],
      toolPromptPayload: inheritedToolPromptPayload,
      thinkingConfig: {
        thinkLevel: "off",
        fastMode: true,
      },
      forkContextMessages: inheritedMessages,
    });

    const runEmbeddedAttempt = await getRunEmbeddedAttempt();
    await runEmbeddedAttempt({
      sessionId: "embedded-session",
      sessionKey: "agent:main:main",
      sessionFile,
      workspaceDir,
      agentDir,
      config: {},
      prompt: "summarize the current session",
      timeoutMs: 30_000,
      runId: "run-inherited-envelope",
      provider: "openai",
      modelId: "gpt-test",
      model: testModel,
      authStorage: {} as never,
      modelRegistry: {} as never,
      thinkLevel: "off",
      senderIsOwner: true,
      disableMessageTool: true,
      specialInheritedPromptEnvelope: inheritedEnvelope,
    });

    expect(hoisted.buildEmbeddedSystemPromptMock).not.toHaveBeenCalled();
    expect(hoisted.applyExtraParamsToAgentMock).toHaveBeenCalledWith(
      expect.anything(),
      {},
      "openai",
      "gpt-test",
      expect.objectContaining({
        fastMode: true,
      }),
      "off",
      "main",
      workspaceDir,
      testModel,
      agentDir,
    );

    const createAgentSessionArgs = hoisted.createAgentSessionMock.mock.calls[0]?.[0] as
      | { customTools?: Array<{ name: string }> }
      | undefined;
    expect(createAgentSessionArgs?.customTools?.map((tool) => tool.name)).toEqual(["read"]);
    expect(session.messages[0]).toEqual(inheritedMessages[0]);
    expect(session.messages).toEqual(
      expect.arrayContaining([{ role: "assistant", content: "done", timestamp: 2 }]),
    );
  });

  it("drops inherited prompt cache key when the embedded fork drifts from the inherited envelope", async () => {
    const workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-inherited-envelope-drift-workspace-"),
    );
    const agentDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-inherited-envelope-drift-agent-"),
    );
    const sessionFile = path.join(workspaceDir, "session.jsonl");
    tempPaths.push(workspaceDir, agentDir);
    await fs.writeFile(sessionFile, "", "utf8");

    hoisted.createCrawClawCodingToolsMock.mockImplementation(() => [
      {
        name: "read",
        label: "read",
        description: "Read files",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [] }),
      },
      {
        name: "exec",
        label: "exec",
        description: "Execute commands",
        parameters: { type: "object", properties: {} },
        execute: async () => ({ content: [] }),
      },
    ]);
    hoisted.applyExtraParamsToAgentMock.mockImplementation(
      (
        _agent: unknown,
        _config: unknown,
        _provider: unknown,
        _modelId: unknown,
        streamParams: unknown,
      ) => ({
        effectiveExtraParams: {
          ...(typeof streamParams === "object" && streamParams ? streamParams : {}),
        } as Record<string, unknown>,
      }),
    );

    const session = createDefaultEmbeddedSession();
    hoisted.createAgentSessionMock.mockResolvedValue({
      session,
    });

    const inheritedMessages = [{ role: "user", content: "from parent", timestamp: 1 }];
    const inheritedToolPromptPayload = [{ name: "read" }];

    const runEmbeddedAttempt = await getRunEmbeddedAttempt();
    await runEmbeddedAttempt({
      sessionId: "embedded-session-drift",
      sessionKey: "agent:main:main",
      sessionFile,
      workspaceDir,
      agentDir,
      config: {},
      prompt: "summarize the current session",
      timeoutMs: 30_000,
      runId: "run-inherited-envelope-drift",
      provider: "openai",
      modelId: "gpt-test",
      model: testModel,
      authStorage: {} as never,
      modelRegistry: {} as never,
      thinkLevel: "off",
      senderIsOwner: true,
      disableMessageTool: true,
      streamParams: {
        cacheRetention: "short",
        skipCacheWrite: true,
        promptCacheKey: "parent:cache:key",
        promptCacheRetention: "24h",
      },
      specialInheritedPromptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "parent system prompt",
        toolNames: ["read"],
        toolPromptPayload: inheritedToolPromptPayload,
        thinkingConfig: {},
        forkContextMessages: inheritedMessages,
      }),
    });

    expect(hoisted.applyExtraParamsToAgentMock).toHaveBeenCalledWith(
      expect.anything(),
      {},
      "openai",
      "gpt-test",
      {
        cacheRetention: "short",
        fastMode: undefined,
        skipCacheWrite: true,
      },
      "off",
      "main",
      workspaceDir,
      testModel,
      agentDir,
    );
    const streamParamsArg = hoisted.applyExtraParamsToAgentMock.mock.calls[0]?.[4] as
      | Record<string, unknown>
      | undefined;
    expect(streamParamsArg?.promptCacheKey).toBeUndefined();
    expect(streamParamsArg?.promptCacheRetention).toBeUndefined();
  });
});
