import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSpecialAgentCacheEnvelope } from "../../special/runtime/parent-fork-context.js";
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

describe("runEmbeddedAttempt special parent prompt envelope", () => {
  const tempPaths: string[] = [];

  beforeEach(() => {
    resetEmbeddedAttemptHarness({
      subscribeImpl: () => createSubscriptionMock(),
    });
  });

  afterEach(async () => {
    await cleanupTempPaths(tempPaths);
  });

  it("uses parent prompt, tool inventory, thinking config, and fork context messages", async () => {
    const workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-parent-envelope-workspace-"),
    );
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-parent-envelope-agent-"));
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

    const parentMessages = [{ role: "user", content: "from parent", timestamp: 1 }];
    const parentToolPromptPayload = [{ name: "read" }];
    const parentEnvelope = buildSpecialAgentCacheEnvelope({
      systemPromptText: "parent system prompt",
      toolNames: ["read"],
      toolPromptPayload: parentToolPromptPayload,
      thinkingConfig: {
        thinkLevel: "off",
        fastMode: true,
      },
      forkContextMessages: parentMessages,
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
      runId: "run-parent-envelope",
      provider: "openai",
      modelId: "gpt-test",
      model: testModel,
      authStorage: {} as never,
      modelRegistry: {} as never,
      thinkLevel: "off",
      senderIsOwner: true,
      disableMessageTool: true,
      specialParentPromptEnvelope: parentEnvelope,
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
    expect(session.messages[0]).toEqual(parentMessages[0]);
    expect(session.messages).toEqual(
      expect.arrayContaining([{ role: "assistant", content: "done", timestamp: 2 }]),
    );
  });

  it("does not reuse the parent system prompt for session-summary special agents", async () => {
    const workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-parent-envelope-summary-workspace-"),
    );
    const agentDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-parent-envelope-summary-agent-"),
    );
    const sessionFile = path.join(workspaceDir, "session.jsonl");
    tempPaths.push(workspaceDir, agentDir);
    await fs.writeFile(sessionFile, "", "utf8");

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

    const parentEnvelope = buildSpecialAgentCacheEnvelope({
      systemPromptText: "parent system prompt",
      toolNames: ["session_summary_file_edit"],
      toolPromptPayload: [{ name: "session_summary_file_edit" }],
      thinkingConfig: {
        thinkLevel: "off",
      },
      forkContextMessages: [{ role: "user", content: "from parent", timestamp: 1 }],
    });

    const runEmbeddedAttempt = await getRunEmbeddedAttempt();
    await runEmbeddedAttempt({
      sessionId: "embedded-session",
      sessionKey: "agent:main:main",
      sessionFile,
      workspaceDir,
      agentDir,
      config: {},
      prompt: "update the session summary",
      timeoutMs: 30_000,
      runId: "run-parent-envelope-summary",
      provider: "openai",
      modelId: "gpt-test",
      model: testModel,
      authStorage: {} as never,
      modelRegistry: {} as never,
      thinkLevel: "off",
      senderIsOwner: true,
      disableMessageTool: true,
      specialAgentSpawnSource: "session-summary",
      specialParentPromptEnvelope: parentEnvelope,
      extraSystemPrompt: "summary-only instructions",
    });

    expect(hoisted.buildEmbeddedSystemPromptMock).not.toHaveBeenCalled();
    expect(session.messages[0]).toEqual({ role: "user", content: "from parent", timestamp: 1 });
  });

  it("uses fork messages without a parent prompt envelope for durable-memory special agents", async () => {
    const workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-parent-envelope-durable-workspace-"),
    );
    const agentDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-parent-envelope-durable-agent-"),
    );
    const sessionFile = path.join(workspaceDir, "session.jsonl");
    tempPaths.push(workspaceDir, agentDir);
    await fs.writeFile(sessionFile, "", "utf8");

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

    const parentForkMessages = [{ role: "user", content: "from parent", timestamp: 1 }];

    const runEmbeddedAttempt = await getRunEmbeddedAttempt();
    await runEmbeddedAttempt({
      sessionId: "embedded-session",
      sessionKey: "agent:main:main",
      sessionFile,
      workspaceDir,
      agentDir,
      config: {},
      prompt: "extract durable memory",
      timeoutMs: 30_000,
      runId: "run-parent-envelope-durable",
      provider: "openai",
      modelId: "gpt-test",
      model: testModel,
      authStorage: {} as never,
      modelRegistry: {} as never,
      thinkLevel: "off",
      senderIsOwner: true,
      disableMessageTool: true,
      specialAgentSpawnSource: "durable-memory",
      specialParentForkMessages: parentForkMessages,
      extraSystemPrompt: "durable-only instructions",
    });

    expect(hoisted.buildEmbeddedSystemPromptMock).not.toHaveBeenCalled();
    expect(session.messages[0]).toEqual({ role: "user", content: "from parent", timestamp: 1 });
  });
});
