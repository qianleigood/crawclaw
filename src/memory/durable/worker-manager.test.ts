import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpecialAgentCacheEnvelope } from "../../agents/special/runtime/parent-fork-context.js";
import {
  makeAgentAssistantMessage,
  makeAgentToolResultMessage,
  makeAgentUserMessage,
} from "../../agents/test-helpers/agent-message-fixtures.js";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type {
  AppendMessageInput,
  DurableExtractionCursorRow,
  GmMessageRow,
  UpsertDurableExtractionCursorInput,
} from "../types/runtime.ts";

describe("DurableExtractionWorkerManager", () => {
  const previousStateDir = process.env.CRAWCLAW_STATE_DIR;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { __testing } = await import("./worker-manager.ts");
    await __testing.resetSharedDurableExtractionWorkerManager();
    if (previousStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = previousStateDir;
    }
  });

  async function createStateDir(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-worker-"));
  }

  type MockRuntimeStore = Pick<
    RuntimeStore,
    | "appendMessage"
    | "getDurableExtractionCursor"
    | "upsertDurableExtractionCursor"
    | "listMessagesByTurnRange"
  >;

  function createRuntimeStore(): MockRuntimeStore {
    let nextMessageId = 0;
    const cursorRows = new Map<string, DurableExtractionCursorRow>();
    const messageRows: GmMessageRow[] = [];
    return {
      appendMessage: vi.fn().mockImplementation(async (input: AppendMessageInput) => {
        const contentText = input.contentText ?? input.content;
        messageRows.push({
          id: `msg-${++nextMessageId}`,
          sessionId: input.sessionId,
          conversationUid: input.conversationUid,
          role: input.role,
          content: input.content,
          contentText,
          contentBlocks: input.contentBlocks ?? [{ type: "text", text: contentText }],
          hasMedia: input.hasMedia ?? false,
          primaryMediaId: input.primaryMediaId ?? null,
          turnIndex: input.turnIndex,
          extracted: false,
          createdAt: input.createdAt ?? Date.now(),
        });
      }),
      getDurableExtractionCursor: vi.fn().mockImplementation(async (sessionId: string) => {
        return cursorRows.get(sessionId) ?? null;
      }),
      upsertDurableExtractionCursor: vi
        .fn()
        .mockImplementation(async (input: UpsertDurableExtractionCursorInput) => {
          cursorRows.set(input.sessionId, {
            sessionId: input.sessionId,
            sessionKey: input.sessionKey ?? null,
            lastExtractedTurn: input.lastExtractedTurn,
            lastExtractedMessageId: input.lastExtractedMessageId ?? null,
            lastRunAt: input.lastRunAt ?? null,
            updatedAt: input.updatedAt ?? Date.now(),
          });
        }),
      listMessagesByTurnRange: vi
        .fn()
        .mockImplementation(async (sessionId: string, startTurn: number, endTurn: number) =>
          messageRows
            .filter((row) => {
              return (
                row.sessionId === sessionId &&
                row.turnIndex >= startTurn &&
                row.turnIndex <= endTurn
              );
            })
            .toSorted((left, right) => left.turnIndex - right.turnIndex),
        ),
    };
  }

  async function appendVisibleMessage(
    runtimeStore: ReturnType<typeof createRuntimeStore>,
    params: { sessionId: string; role?: "user" | "assistant"; content: string; turnIndex: number },
  ): Promise<void> {
    await runtimeStore.appendMessage({
      sessionId: params.sessionId,
      conversationUid: params.sessionId,
      role: params.role ?? "user",
      content: params.content,
      turnIndex: params.turnIndex,
    });
  }

  async function appendToolResultMessage(
    runtimeStore: ReturnType<typeof createRuntimeStore>,
    params: {
      sessionId: string;
      toolCallId: string;
      toolName: string;
      content: string;
      turnIndex: number;
      isError?: boolean;
    },
  ): Promise<void> {
    await runtimeStore.appendMessage({
      sessionId: params.sessionId,
      conversationUid: params.sessionId,
      role: "toolResult",
      content: params.content,
      contentText: params.content,
      contentBlocks: [{ type: "text", text: params.content }],
      runtimeShape: {
        toolCallId: params.toolCallId,
        toolName: params.toolName,
        isError: params.isError === true,
      },
      turnIndex: params.turnIndex,
    });
  }

  function createRunnerQueue(
    queue: Array<{
      waitFor?: Promise<unknown>;
      result: {
        status: "written" | "skipped" | "no_change" | "failed";
        notesSaved: number;
        reason?: string;
        advanceCursor: boolean;
      };
    }>,
  ) {
    return vi.fn().mockImplementation(async (_params) => {
      const next = queue.shift() ?? {
        result: {
          status: "no_change",
          notesSaved: 0,
          advanceCursor: true,
        },
      };
      if (next.waitFor) {
        await next.waitFor;
      }
      return next.result;
    });
  }

  function createParentForkContext(params?: { parentRunId?: string; messages?: unknown[] }) {
    return {
      parentRunId: params?.parentRunId ?? "parent-run-test",
      provider: "openai",
      modelId: "gpt-5.4",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "parent system prompt",
        forkContextMessages: params?.messages ?? [
          makeAgentUserMessage({ content: "父会话上下文。" }),
        ],
      }),
    };
  }

  it("keeps one worker per session and runs a trailing extraction with the latest pending context", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtimeStore = createRuntimeStore();
    const runner = createRunnerQueue([
      {
        waitFor: first,
        result: {
          status: "no_change",
          notesSaved: 0,
          reason: "noop",
          advanceCursor: true,
        },
      },
      {
        result: {
          status: "written",
          notesSaved: 1,
          reason: "saved trailing note",
          advanceCursor: true,
        },
      },
    ]);

    const { getSharedDurableExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedDurableExtractionWorkerManager({
      config: {
        enabled: true,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 2,
        workerIdleTtlMs: 60_000,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-1",
      content: "记住第一条 durable note。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:direct:user-1",
      newMessages: [makeAgentUserMessage({ content: "记住第一条 durable note。" })] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-1",
        parentRunId: "parent-run-1",
        parentForkContext: createParentForkContext(),
      },
    });
    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-1",
      content: "记住第二条 durable note。",
      turnIndex: 2,
    });
    await manager.submitTurn({
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:direct:user-1",
      newMessages: [makeAgentUserMessage({ content: "记住第二条 durable note。" })] as never,
      messageCursor: 2,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-1",
        parentForkContext: createParentForkContext(),
      },
    });

    expect(manager.getStatus()).toMatchObject({
      workerCount: 1,
      runningCount: 1,
    });

    releaseFirst();

    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(2);
    });
    const secondCall = runner.mock.calls.at(-1)?.[0];
    const firstCall = runner.mock.calls[0]?.[0];
    expect(firstCall?.parentRunId).toBe("parent-run-1");
    expect(secondCall?.newMessageCount).toBe(1);
    expect(secondCall).not.toHaveProperty("recentMessages");
  });

  it("applies a global concurrency limit across sessions", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtimeStore = createRuntimeStore();
    const runner = createRunnerQueue([
      {
        waitFor: first,
        result: {
          status: "no_change",
          notesSaved: 0,
          reason: "noop",
          advanceCursor: true,
        },
      },
      {
        result: {
          status: "written",
          notesSaved: 1,
          reason: "session-b",
          advanceCursor: true,
        },
      },
    ]);

    const { getSharedDurableExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedDurableExtractionWorkerManager({
      config: {
        enabled: true,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 1,
        workerIdleTtlMs: 60_000,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-a",
      content: "先处理第一个 session。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-a",
      sessionKey: "agent:main:feishu:direct:user-a",
      newMessages: [makeAgentUserMessage({ content: "先处理第一个 session。" })] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-a",
        parentForkContext: createParentForkContext(),
      },
    });
    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-b",
      content: "然后处理第二个 session。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-b",
      sessionKey: "agent:main:feishu:direct:user-b",
      newMessages: [makeAgentUserMessage({ content: "然后处理第二个 session。" })] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-b",
        parentForkContext: createParentForkContext(),
      },
    });

    expect(manager.getStatus()).toMatchObject({
      workerCount: 2,
      runningCount: 1,
      queuedCount: 1,
    });

    releaseFirst();

    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(2);
    });
    const secondCall = runner.mock.calls.at(-1)?.[0];
    expect(secondCall?.sessionId).toBe("session-b");
  });

  it("serializes concurrent runs that target the same durable scope", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtimeStore = createRuntimeStore();
    const runner = createRunnerQueue([
      {
        waitFor: first,
        result: {
          status: "written",
          notesSaved: 1,
          reason: "first same-scope run",
          advanceCursor: true,
        },
      },
      {
        result: {
          status: "written",
          notesSaved: 1,
          reason: "second same-scope run",
          advanceCursor: true,
        },
      },
    ]);

    const { getSharedDurableExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedDurableExtractionWorkerManager({
      config: {
        enabled: true,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 2,
        workerIdleTtlMs: 60_000,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-scope-a",
      content: "同一个用户的第一个会话触发 durable memory。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-scope-a",
      sessionKey: "agent:main:feishu:direct:user-same:thread:a",
      newMessages: [
        makeAgentUserMessage({ content: "同一个用户的第一个会话触发 durable memory。" }),
      ] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-same",
        parentForkContext: createParentForkContext(),
      },
    });

    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(1);
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-scope-b",
      content: "同一个用户的第二个会话也触发 durable memory。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-scope-b",
      sessionKey: "agent:main:feishu:direct:user-same:thread:b",
      newMessages: [
        makeAgentUserMessage({ content: "同一个用户的第二个会话也触发 durable memory。" }),
      ] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-same",
        parentForkContext: createParentForkContext(),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(runner).toHaveBeenCalledTimes(1);
    expect(manager.getStatus()).toMatchObject({
      runningCount: 1,
      queuedCount: 1,
    });

    releaseFirst();

    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(2);
    });
    const secondCall = runner.mock.calls.at(-1)?.[0];
    expect(secondCall?.sessionId).toBe("session-scope-b");
  });

  it("serializes runs for the same agent even when channel and user differ", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const runtimeStore = createRuntimeStore();
    const runner = createRunnerQueue([
      {
        waitFor: first,
        result: {
          status: "written",
          notesSaved: 1,
          reason: "first agent-scoped run",
          advanceCursor: true,
        },
      },
      {
        result: {
          status: "written",
          notesSaved: 1,
          reason: "second agent-scoped run",
          advanceCursor: true,
        },
      },
    ]);

    const { getSharedDurableExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedDurableExtractionWorkerManager({
      config: {
        enabled: true,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 2,
        workerIdleTtlMs: 60_000,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-agent-a",
      content: "同一个 agent 的第一个会话触发 durable memory。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-agent-a",
      sessionKey: "agent:main:discord:direct:user-a",
      newMessages: [
        makeAgentUserMessage({ content: "同一个 agent 的第一个会话触发 durable memory。" }),
      ] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "discord",
        senderId: "user-a",
        parentForkContext: createParentForkContext(),
      },
    });

    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(1);
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-agent-b",
      content: "同一个 agent 的第二个会话触发 durable memory。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-agent-b",
      sessionKey: "agent:main:slack:direct:user-b",
      newMessages: [
        makeAgentUserMessage({ content: "同一个 agent 的第二个会话触发 durable memory。" }),
      ] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "slack",
        senderId: "user-b",
        parentForkContext: createParentForkContext(),
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(runner).toHaveBeenCalledTimes(1);
    expect(manager.getStatus()).toMatchObject({
      runningCount: 1,
      queuedCount: 1,
    });

    releaseFirst();

    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(2);
    });
    const secondCall = runner.mock.calls.at(-1)?.[0];
    expect(secondCall?.sessionId).toBe("session-agent-b");
  });

  it("allows different agents to run concurrently up to the global limit", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const runtimeStore = createRuntimeStore();
    const runner = createRunnerQueue([
      {
        waitFor: first,
        result: {
          status: "written",
          notesSaved: 1,
          reason: "first different-agent run",
          advanceCursor: true,
        },
      },
      {
        waitFor: second,
        result: {
          status: "written",
          notesSaved: 1,
          reason: "second different-agent run",
          advanceCursor: true,
        },
      },
    ]);

    const { getSharedDurableExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedDurableExtractionWorkerManager({
      config: {
        enabled: true,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 2,
        workerIdleTtlMs: 60_000,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-agent-main",
      content: "main agent 触发 durable memory。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-agent-main",
      sessionKey: "agent:main:feishu:direct:user-a",
      newMessages: [makeAgentUserMessage({ content: "main agent 触发 durable memory。" })] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-a",
        parentForkContext: createParentForkContext(),
      },
    });
    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-agent-research",
      content: "research agent 触发 durable memory。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-agent-research",
      sessionKey: "agent:research:slack:direct:user-b",
      newMessages: [
        makeAgentUserMessage({ content: "research agent 触发 durable memory。" }),
      ] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "research",
        messageChannel: "slack",
        senderId: "user-b",
        parentForkContext: createParentForkContext(),
      },
    });

    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(2);
    });
    expect(manager.getStatus()).toMatchObject({
      runningCount: 2,
      queuedCount: 0,
    });

    releaseFirst();
    releaseSecond();
  });

  it("cleans up idle workers and drains in-flight runs", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtimeStore = createRuntimeStore();
    const runner = createRunnerQueue([
      {
        waitFor: delayed,
        result: {
          status: "written",
          notesSaved: 1,
          reason: "drain",
          advanceCursor: true,
        },
      },
    ]);

    const { getSharedDurableExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedDurableExtractionWorkerManager({
      config: {
        enabled: true,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 1,
        workerIdleTtlMs: 10,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-c",
      content: "记住这条。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-c",
      sessionKey: "agent:main:feishu:direct:user-c",
      newMessages: [makeAgentUserMessage({ content: "记住这条。" })] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-c",
        parentForkContext: createParentForkContext(),
      },
    });

    const drainPromise = manager.drainAll(5_000);
    release();
    await drainPromise;

    expect(runner).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().workerCount).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    manager.cleanupIdle();
    expect(manager.getStatus().workerCount).toBe(0);
  });

  it("stops a session worker and drops pending trailing context", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtimeStore = createRuntimeStore();
    const runner = createRunnerQueue([
      {
        waitFor: delayed,
        result: {
          status: "no_change",
          notesSaved: 0,
          reason: "noop",
          advanceCursor: true,
        },
      },
      {
        result: {
          status: "written",
          notesSaved: 1,
          reason: "should_not_run",
          advanceCursor: true,
        },
      },
    ]);

    const { getSharedDurableExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedDurableExtractionWorkerManager({
      config: {
        enabled: true,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 1,
        workerIdleTtlMs: 60_000,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-d",
      content: "第一条消息。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-d",
      sessionKey: "agent:main:feishu:direct:user-d",
      newMessages: [makeAgentUserMessage({ content: "第一条消息。" })] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-d",
        parentForkContext: createParentForkContext(),
      },
    });
    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-d",
      content: "第二条消息。",
      turnIndex: 2,
    });
    await manager.submitTurn({
      sessionId: "session-d",
      sessionKey: "agent:main:feishu:direct:user-d",
      newMessages: [makeAgentUserMessage({ content: "第二条消息。" })] as never,
      messageCursor: 2,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-d",
        parentForkContext: createParentForkContext(),
      },
    });

    const stopPromise = manager.stopSession("agent:main:feishu:direct:user-d", {
      timeoutMs: 1_000,
    });
    release();
    await stopPromise;

    expect(manager.getStatus().workerCount).toBe(0);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("prefers the background durable memory runner when configured", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const runtimeStore = createRuntimeStore();
    const fullForkMessages = [
      makeAgentUserMessage({ content: "旧上下文：中文回答。" }),
      makeAgentUserMessage({ content: "以后默认先给步骤。" }),
    ];
    const parentForkContext = {
      parentRunId: "parent-run-runner",
      provider: "openai",
      modelId: "gpt-5.4",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "parent system prompt",
        forkContextMessages: fullForkMessages,
      }),
    };
    const runner = vi.fn().mockResolvedValue({
      status: "written",
      notesSaved: 2,
      reason: "background_agent",
      advanceCursor: true,
    });

    const { getSharedDurableExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedDurableExtractionWorkerManager({
      config: {
        enabled: true,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 1,
        workerIdleTtlMs: 60_000,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-runner",
      content: "以后默认先给步骤。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-runner",
      sessionKey: "agent:main:feishu:direct:user-runner",
      newMessages: [makeAgentUserMessage({ content: "以后默认先给步骤。" })] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-runner",
        parentForkContext,
      },
    });

    await vi.waitFor(async () => {
      expect(runner).toHaveBeenCalledTimes(1);
      await expect(
        runtimeStore.getDurableExtractionCursor("session-runner"),
      ).resolves.toMatchObject({
        lastExtractedTurn: 1,
      });
    });

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-runner",
        sessionKey: "agent:main:feishu:direct:user-runner",
        messageCursor: 1,
        newMessageCount: 1,
        maxNotes: 2,
        parentForkContext,
      }),
    );
  });

  it("counts cursor deltas by model-visible messages when tool results dominate", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const runtimeStore = createRuntimeStore();
    await runtimeStore.upsertDurableExtractionCursor({
      sessionId: "session-tools",
      sessionKey: "agent:main:feishu:direct:user-tools",
      lastExtractedTurn: 2,
      lastRunAt: Date.now(),
    });
    const runner = vi.fn().mockResolvedValue({
      status: "no_change",
      notesSaved: 0,
      reason: "noop",
      advanceCursor: true,
    });

    const { getSharedDurableExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedDurableExtractionWorkerManager({
      config: {
        enabled: true,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 1,
        workerIdleTtlMs: 60_000,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-tools",
      content: "以后审查先列风险。",
      turnIndex: 3,
    });
    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-tools",
      role: "assistant",
      content: "我会先读取上下文。",
      turnIndex: 4,
    });
    for (let index = 0; index < 12; index += 1) {
      await appendToolResultMessage(runtimeStore, {
        sessionId: "session-tools",
        toolCallId: `read-${index}`,
        toolName: "read",
        content: `tool result ${index}`,
        turnIndex: 5 + index,
      });
    }
    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-tools",
      role: "assistant",
      content: "明白，审查会先列风险。",
      turnIndex: 17,
    });
    const parentForkContext = createParentForkContext({
      messages: [
        makeAgentUserMessage({ content: "以后审查先列风险。" }),
        makeAgentAssistantMessage({
          stopReason: "toolUse",
          content: [
            { type: "toolUse", id: "read-0", name: "read", input: { path: "MEMORY.md" } },
          ] as never,
        }),
        makeAgentToolResultMessage({
          toolCallId: "read-0",
          toolName: "read",
          content: [{ type: "text", text: "tool result 0" }],
        }),
        makeAgentAssistantMessage({
          content: [{ type: "text", text: "明白，审查会先列风险。" }],
        }),
      ],
    });

    await manager.submitTurn({
      sessionId: "session-tools",
      sessionKey: "agent:main:feishu:direct:user-tools",
      newMessages: [
        makeAgentUserMessage({ content: "以后审查先列风险。" }),
        ...Array.from({ length: 12 }, (_, index) =>
          makeAgentToolResultMessage({
            toolCallId: `read-${index}`,
            toolName: "read",
            content: [{ type: "text", text: `tool result ${index}` }],
          }),
        ),
        makeAgentAssistantMessage({
          content: [{ type: "text", text: "明白，审查会先列风险。" }],
        }),
      ] as never,
      messageCursor: 17,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-tools",
        parentForkContext,
      },
    });

    await vi.waitFor(async () => {
      expect(runner).toHaveBeenCalledTimes(1);
      await expect(runtimeStore.getDurableExtractionCursor("session-tools")).resolves.toMatchObject(
        {
          lastExtractedTurn: 17,
          lastExtractedMessageId: "msg-15",
        },
      );
    });
    const runnerInput = runner.mock.calls[0]?.[0];
    expect(runnerInput).toEqual(
      expect.objectContaining({
        messageCursor: 17,
        newMessageCount: 3,
        parentForkContext,
      }),
    );
  });

  it("runs background extraction after a failed explicit durable write", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const runtimeStore = createRuntimeStore();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runner = vi.fn().mockResolvedValue({
      status: "failed",
      notesSaved: 0,
      reason: "fallback_failed",
      advanceCursor: false,
    });

    const { getSharedDurableExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedDurableExtractionWorkerManager({
      config: {
        enabled: true,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 1,
        workerIdleTtlMs: 60_000,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger,
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-failed-direct-write",
      role: "assistant",
      content: "I will update durable memory.",
      turnIndex: 1,
    });
    await appendToolResultMessage(runtimeStore, {
      sessionId: "session-failed-direct-write",
      toolCallId: "call-failed-write",
      toolName: "memory_note_write",
      content: '{"status":"error"}',
      turnIndex: 2,
      isError: true,
    });

    await manager.submitTurn({
      sessionId: "session-failed-direct-write",
      sessionKey: "agent:main:feishu:direct:user-failed-direct-write",
      newMessages: [
        makeAgentAssistantMessage({
          content: [{ type: "text", text: "I will update durable memory." }],
        }),
        makeAgentToolResultMessage({
          toolCallId: "call-failed-write",
          toolName: "memory_note_write",
          content: [{ type: "text", text: '{"status":"error"}' }],
          details: { status: "error" },
          isError: true,
        }),
      ] as never,
      messageCursor: 2,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-failed-direct-write",
        parentForkContext: createParentForkContext(),
      },
    });

    await vi.waitFor(async () => {
      expect(runner).toHaveBeenCalledTimes(1);
      await expect(
        runtimeStore.getDurableExtractionCursor("session-failed-direct-write"),
      ).resolves.toBeNull();
    });
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("skipped_direct_write"));
  });

  it("fails closed when the background runner fails", async () => {
    const stateDir = await createStateDir();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const runtimeStore = createRuntimeStore();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runner = vi.fn().mockResolvedValue({
      status: "failed",
      notesSaved: 0,
      reason: "agent_failed",
      advanceCursor: false,
    });

    const { getSharedDurableExtractionWorkerManager } = await import("./worker-manager.ts");
    const manager = getSharedDurableExtractionWorkerManager({
      config: {
        enabled: true,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 1,
        workerIdleTtlMs: 60_000,
      },
      runtimeStore: runtimeStore as unknown as RuntimeStore,
      runner,
      logger,
    });

    await appendVisibleMessage(runtimeStore, {
      sessionId: "session-fallback",
      content: "以后别重复背景，先给结论。",
      turnIndex: 1,
    });
    await manager.submitTurn({
      sessionId: "session-fallback",
      sessionKey: "agent:main:feishu:direct:user-fallback",
      newMessages: [makeAgentUserMessage({ content: "以后别重复背景，先给结论。" })] as never,
      messageCursor: 1,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-fallback",
        parentForkContext: createParentForkContext(),
      },
    });

    await vi.waitFor(async () => {
      await expect(runtimeStore.getDurableExtractionCursor("session-fallback")).resolves.toBeNull();
    });

    expect(runner).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "durable extraction failed sessionKey=agent:main:feishu:direct:user-fallback",
      ),
    );
  });
});
