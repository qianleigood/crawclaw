import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitRunLoopLifecycleEvent } from "../../agents/runtime/lifecycle/bus.js";
import { buildSpecialAgentCacheEnvelope } from "../../agents/special/runtime/parent-fork-context.js";
import {
  castAgentMessages,
  makeAgentAssistantMessage,
  makeAgentToolResultMessage,
  makeAgentUserMessage,
} from "../../agents/test-helpers/agent-message-fixtures.js";
import { upsertDurableMemoryNote } from "../durable/store.ts";
import type {
  DurableExtractionRunParams,
  DurableExtractionRunResult,
  DurableExtractionRunner,
} from "../durable/worker-manager.ts";
import { drainSharedDurableExtractionWorkers } from "../durable/worker-manager.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { MemoryRuntimeConfig } from "../types/config.ts";
import type {
  DurableExtractionCursorRow,
  GmMessageRow,
  SessionSummaryStateRow,
} from "../types/runtime.ts";

vi.mock("../notebooklm/notebooklm-cli.ts", () => ({
  searchNotebookLmViaCli: vi.fn().mockResolvedValue([]),
}));

vi.mock("../notebooklm/heartbeat.ts", () => ({
  startNotebookLmHeartbeat: vi.fn(),
}));

describe("createContextMemoryRuntime() lifecycle-driven memory scheduling", () => {
  const previousStateDir = process.env.CRAWCLAW_STATE_DIR;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    return import("../durable/worker-manager.ts")
      .then(async ({ __testing }) => {
        await __testing.resetSharedDurableExtractionWorkerManager();
      })
      .then(async () => {
        const { __testing } = await import("../durable/lifecycle-subscriber.ts");
        __testing.resetSharedDurableExtractionLifecycleSubscriber();
      })
      .then(async () => {
        const { __testing } = await import("../dreaming/lifecycle-subscriber.ts");
        __testing.resetSharedAutoDreamLifecycleSubscriber();
      })
      .then(async () => {
        const { __testing } = await import("../session-summary/lifecycle-subscriber.ts");
        __testing.resetSharedSessionSummaryLifecycleSubscriber();
      })
      .finally(() => {
        if (previousStateDir === undefined) {
          delete process.env.CRAWCLAW_STATE_DIR;
        } else {
          process.env.CRAWCLAW_STATE_DIR = previousStateDir;
        }
      });
  });

  async function createRuntimeRoot(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-memory-lifecycle-"));
  }

  function asRuntimeStore(store: Partial<RuntimeStore>): RuntimeStore {
    return store as RuntimeStore;
  }

  function asAssistantContent(
    content: unknown,
  ): Parameters<typeof makeAgentAssistantMessage>[0]["content"] {
    return content as Parameters<typeof makeAgentAssistantMessage>[0]["content"];
  }

  function createRuntimeStore(): RuntimeStore {
    let nextMessageId = 0;
    const cursorRows = new Map<string, DurableExtractionCursorRow>();
    const messageRows: GmMessageRow[] = [];
    const sessionSummaryState = new Map<string, SessionSummaryStateRow>();
    return asRuntimeStore({
      appendMessage: vi.fn().mockImplementation(async (input) => {
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
          runtimeMeta: input.runtimeMeta ?? null,
          runtimeShape: input.runtimeShape ?? null,
          turnIndex: input.turnIndex,
          extracted: false,
          createdAt: input.createdAt ?? Date.now(),
        });
      }),
      appendRawEvent: vi.fn().mockResolvedValue(undefined),
      upsertMediaAsset: vi.fn().mockResolvedValue(undefined),
      getDurableExtractionCursor: vi
        .fn()
        .mockImplementation(async (sessionId: string) => cursorRows.get(sessionId) ?? null),
      upsertDurableExtractionCursor: vi.fn().mockImplementation(async (input) => {
        cursorRows.set(input.sessionId, {
          sessionId: input.sessionId,
          sessionKey: input.sessionKey ?? null,
          lastExtractedTurn: input.lastExtractedTurn,
          lastExtractedMessageId: input.lastExtractedMessageId ?? null,
          lastRunAt: input.lastRunAt ?? null,
          updatedAt: input.updatedAt ?? Date.now(),
        });
      }),
      upsertSessionScope: vi.fn().mockResolvedValue(undefined),
      getSessionSummaryState: vi
        .fn()
        .mockImplementation(
          async (sessionId: string) => sessionSummaryState.get(sessionId) ?? null,
        ),
      upsertSessionSummaryState: vi.fn().mockImplementation(async (input) => {
        sessionSummaryState.set(input.sessionId, {
          sessionId: input.sessionId,
          lastSummarizedMessageId: input.lastSummarizedMessageId ?? null,
          lastSummaryUpdatedAt: input.lastSummaryUpdatedAt ?? null,
          tokensAtLastSummary: input.tokensAtLastSummary ?? 0,
          summaryInProgress: Boolean(input.summaryInProgress),
          updatedAt: Date.now(),
        });
      }),
      listMessagesByTurnRange: vi
        .fn()
        .mockImplementation(async (sessionId: string, fromTurn: number, toTurn: number) =>
          messageRows
            .filter(
              (row) =>
                row.sessionId === sessionId && row.turnIndex >= fromTurn && row.turnIndex <= toTurn,
            )
            .toSorted((left, right) => left.turnIndex - right.turnIndex),
        ),
      listScopedSessionIdsTouchedSince: vi.fn().mockResolvedValue([]),
      getDreamState: vi.fn().mockResolvedValue(null),
      touchDreamAttempt: vi.fn().mockResolvedValue(undefined),
      acquireDreamLock: vi.fn().mockResolvedValue({
        acquired: false,
        state: {
          scopeKey: "main:feishu:user-1",
          lastSuccessAt: null,
          lastAttemptAt: null,
          lastFailureAt: null,
          lockOwner: null,
          lockAcquiredAt: null,
          lastRunId: null,
          updatedAt: Date.now(),
        },
      }),
      releaseDreamLock: vi.fn().mockResolvedValue(undefined),
      createMaintenanceRun: vi.fn().mockResolvedValue("mrun-1"),
      updateMaintenanceRun: vi.fn().mockResolvedValue(undefined),
      listModelVisibleMessagesForDurableExtraction: vi
        .fn()
        .mockImplementation(
          async (
            sessionId: string,
            afterTurnExclusive: number,
            upToTurnInclusive: number,
            limit: number,
          ) =>
            messageRows
              .filter(
                (row) =>
                  row.sessionId === sessionId &&
                  (row.role === "user" || row.role === "assistant") &&
                  row.turnIndex > afterTurnExclusive &&
                  row.turnIndex <= upToTurnInclusive,
              )
              .toSorted((left, right) => left.turnIndex - right.turnIndex)
              .slice(-limit),
        ),
    });
  }

  function createRuntimeConfig(overrides?: {
    minEligibleTurnsBetweenRuns?: number;
  }): MemoryRuntimeConfig {
    return {
      runtimeStore: { type: "sqlite", dbPath: "/tmp/crawclaw-memory.db" },
      automation: {
        enabled: false,
        maxJobAttempts: 3,
        schedulerPollIntervalMs: 15_000,
        extractionJobTimeoutMs: 120_000,
        stages: {
          ingest: true,
          distill: true,
          judge: true,
          govern: true,
          formalize: true,
          reconcile: true,
          maintain: true,
        },
      },
      multimodal: {
        storage: { cacheDir: "/tmp/crawclaw-memory-media", maxAssetBytes: 1024 },
      },
      llm: undefined,
      llms: undefined,
      dedup: {
        minScore: 0.62,
        autoApplyScore: 0.85,
        autoRunOnWrite: false,
        autoRunLimit: 200,
        whitelist: [],
        blacklist: [],
        forbidCrossTypePairs: [],
        forbidNamePatterns: [],
      },
      governance: {
        staleAfterDays: 30,
        markValidationStaleWithLifecycle: true,
      },
      skillRouting: {
        enabled: false,
        ttlMs: 60_000,
        shortlistLimit: 5,
        extraRoots: [],
      },
      durableExtraction: {
        enabled: true,
        recentMessageLimit: 8,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: overrides?.minEligibleTurnsBetweenRuns ?? 1,
        maxConcurrentWorkers: 2,
        workerIdleTtlMs: 60_000,
      },
      notebooklm: {
        enabled: false,
        auth: {
          profile: "default",
          autoRefresh: false,
          statusTtlMs: 60_000,
          degradedCooldownMs: 60_000,
          refreshCooldownMs: 60_000,
          heartbeat: {
            enabled: false,
            minIntervalMs: 60_000,
            maxIntervalMs: 120_000,
          },
        },
        cli: { enabled: false, command: "", args: [], timeoutMs: 1, limit: 5 },
        write: { enabled: false, command: "", args: [], timeoutMs: 1 },
      },
      dreaming: {
        enabled: false,
        minHours: 24,
        minSessions: 5,
        scanThrottleMs: 600_000,
        lockStaleAfterMs: 3_600_000,
      },
      sessionSummary: {
        enabled: false,
        rootDir: "/tmp/crawclaw-session-summary",
        minTokensToInit: 10_000,
        minTokensBetweenUpdates: 5_000,
        toolCallsBetweenUpdates: 3,
        maxWaitMs: 30_000,
        maxTurns: 5,
      },
    };
  }

  function createDurableExtractionRunner(plan: {
    current: {
      status: DurableExtractionRunResult["status"];
      reason?: string;
      notes?: Array<{
        type: "user" | "feedback" | "project" | "reference";
        title: string;
        description?: string;
        body?: string;
        dedupeKey?: string;
      }>;
    };
  }): DurableExtractionRunner {
    return vi.fn().mockImplementation(async (params: DurableExtractionRunParams) => {
      const notes = plan.current.notes ?? [];
      for (const note of notes) {
        await upsertDurableMemoryNote({
          scope: params.scope,
          input: note,
        });
      }
      return {
        status: plan.current.status,
        notesSaved: notes.length,
        reason: plan.current.reason,
        advanceCursor: plan.current.status !== "failed",
      };
    });
  }

  async function emitStopPhase(params: {
    sessionId: string;
    sessionKey: string;
    agentId?: string;
    messageCount: number;
    prePromptMessageCount?: number;
    parentForkContext?: unknown;
  }): Promise<void> {
    await emitRunLoopLifecycleEvent({
      phase: "stop",
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      agentId: params.agentId ?? "main",
      isTopLevel: true,
      sessionFile: "/tmp/session.jsonl",
      messageCount: params.messageCount,
      metadata: {
        prePromptMessageCount: params.prePromptMessageCount ?? 0,
        messageChannel: "feishu",
        senderId: "user-1",
        ...(params.parentForkContext ? { parentForkContext: params.parentForkContext } : {}),
      },
    });
  }

  it("schedules durable extraction from the lifecycle spine stop phase when the turn had no direct durable write", async () => {
    const stateDir = await createRuntimeRoot();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const plan = {
      current: {
        status: "written" as const,
        reason: "recent preference",
        notes: [
          {
            type: "feedback" as const,
            title: "回答先给步骤",
            description: "用户偏好操作类问题先给步骤。",
            body: "默认先给可执行步骤，再补充解释。",
            dedupeKey: "step-first-answers",
          },
        ],
      },
    };
    const durableExtractionRunner = createDurableExtractionRunner(plan);

    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const runtime = createContextMemoryRuntime({
      runtimeStore: createRuntimeStore(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: createRuntimeConfig(),
      durableExtractionRunner,
    });
    const messages = castAgentMessages([
      makeAgentUserMessage({ content: "以后回答操作类问题先给步骤。" }),
      makeAgentAssistantMessage({
        content: [{ type: "text", text: "好的，以后我会先给步骤，再补充解释。" }],
      }),
    ]);
    const parentForkContext = {
      parentRunId: "parent-run-durable-1",
      provider: "openai",
      modelId: "gpt-5.4",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "parent system prompt",
        toolNames: ["read"],
        toolPromptPayload: [{ name: "read" }],
        thinkingConfig: {},
        forkContextMessages: messages,
      }),
    };

    await runtime.afterTurn?.({
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session.jsonl",
      messages,
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });
    await emitStopPhase({
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:direct:user-1",
      messageCount: 2,
      parentForkContext,
    });
    await drainSharedDurableExtractionWorkers();

    await vi.waitFor(async () => {
      const note = await fs.readFile(
        path.join(
          stateDir,
          "durable-memory",
          "agents",
          "main",
          "channels",
          "feishu",
          "users",
          "user-1",
          "60 Preferences",
          "step-first-answers.md",
        ),
        "utf8",
      );
      expect(note).toContain("回答先给步骤");
    });
    expect(durableExtractionRunner).toHaveBeenCalledTimes(1);
    const runnerInput = vi.mocked(durableExtractionRunner).mock.calls[0]?.[0] as
      | {
          parentForkContext?: {
            parentRunId?: string;
            promptEnvelope?: { forkContextMessages?: unknown[] };
          };
          recentMessages?: unknown[];
        }
      | undefined;
    expect(runnerInput?.parentForkContext?.parentRunId).toBe("parent-run-durable-1");
    expect(runnerInput?.parentForkContext?.promptEnvelope?.forkContextMessages).toEqual(messages);
  });

  it("does not schedule durable extraction from ingestion alone before the lifecycle stop phase fires", async () => {
    const stateDir = await createRuntimeRoot();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const durableExtractionRunner = createDurableExtractionRunner({
      current: {
        status: "written",
        reason: "should not run",
        notes: [],
      },
    });

    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const runtime = createContextMemoryRuntime({
      runtimeStore: createRuntimeStore(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: createRuntimeConfig(),
      durableExtractionRunner,
    });

    await runtime.afterTurn?.({
      sessionId: "session-incomplete",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session.jsonl",
      messages: castAgentMessages([
        makeAgentUserMessage({ content: "记住这次风格。" }),
        makeAgentAssistantMessage({
          stopReason: "toolUse",
          content: asAssistantContent([
            { type: "toolUse", id: "call-1", name: "read", input: { path: "MEMORY.md" } },
          ]),
        }),
      ]),
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });
    await drainSharedDurableExtractionWorkers();

    expect(durableExtractionRunner).not.toHaveBeenCalled();
  });

  it("does not schedule session summary work during ingestion alone", async () => {
    const stateDir = await createRuntimeRoot();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const sessionSummaryRunner = vi.fn();

    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const runtime = createContextMemoryRuntime({
      runtimeStore: createRuntimeStore(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: {
        ...createRuntimeConfig(),
        durableExtraction: {
          ...createRuntimeConfig().durableExtraction,
          enabled: false,
        },
        sessionSummary: {
          ...createRuntimeConfig().sessionSummary,
          enabled: true,
          minTokensToInit: 1,
          minTokensBetweenUpdates: 1,
        },
      },
      sessionSummaryRunner,
    });

    await runtime.afterTurn?.({
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session.jsonl",
      messages: castAgentMessages([
        makeAgentUserMessage({ content: "summarize this session" }),
        makeAgentAssistantMessage({ content: [{ type: "text", text: "done" }] }),
      ]),
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });

    expect(sessionSummaryRunner).not.toHaveBeenCalled();
  });

  it("schedules session summary work from the lifecycle spine post_sampling phase when tool-call threshold is met", async () => {
    const stateDir = await createRuntimeRoot();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const sessionSummaryRunner = vi.fn().mockResolvedValue({
      status: "no_change",
      writtenCount: 0,
      updatedCount: 0,
    });

    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const runtime = createContextMemoryRuntime({
      runtimeStore: createRuntimeStore(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: {
        ...createRuntimeConfig(),
        durableExtraction: {
          ...createRuntimeConfig().durableExtraction,
          enabled: false,
        },
        sessionSummary: {
          ...createRuntimeConfig().sessionSummary,
          enabled: true,
          minTokensToInit: 1,
          minTokensBetweenUpdates: 1,
          toolCallsBetweenUpdates: 2,
        },
      },
      sessionSummaryRunner,
    });

    const messages = castAgentMessages([
      makeAgentUserMessage({ content: "summarize this session" }),
      makeAgentAssistantMessage({
        content: asAssistantContent([
          { type: "text", text: "working through file reads" },
          { type: "toolUse", id: "call-1", name: "read", input: { path: "a.ts" } },
          { type: "toolUse", id: "call-2", name: "read", input: { path: "b.ts" } },
        ]),
      }),
    ]);
    const lifecycleModelVisibleMessages = castAgentMessages([
      makeAgentAssistantMessage({
        content: [{ type: "text", text: "Compacted summary from previous turns." }],
      }),
      ...messages,
    ]);
    const parentForkContext = {
      parentRunId: "parent-run-lifecycle-1",
      provider: "openai",
      modelId: "gpt-5.4",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "parent system prompt",
        toolNames: ["read"],
        toolPromptPayload: [{ name: "read" }],
        thinkingConfig: {},
        forkContextMessages: lifecycleModelVisibleMessages,
      }),
    };

    await runtime.afterTurn?.({
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session.jsonl",
      messages: lifecycleModelVisibleMessages,
      prePromptMessageCount: 1,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });
    await emitRunLoopLifecycleEvent({
      phase: "post_sampling",
      runId: "parent-run-lifecycle-1",
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:direct:user-1",
      agentId: "main",
      isTopLevel: true,
      sessionFile: "/tmp/session.jsonl",
      messageCount: lifecycleModelVisibleMessages.length,
      metadata: {
        prePromptMessageCount: 1,
        parentForkContext,
      },
    });

    await vi.waitFor(() => {
      expect(sessionSummaryRunner).toHaveBeenCalledTimes(1);
    });
    const runnerInput = sessionSummaryRunner.mock.calls[0]?.[0] as
      | {
          parentForkContext?: {
            parentRunId?: string;
            promptEnvelope?: { forkContextMessages?: unknown[] };
          };
          recentMessages?: unknown[];
        }
      | undefined;
    expect(runnerInput?.parentForkContext?.parentRunId).toBe("parent-run-lifecycle-1");
    expect(runnerInput?.recentMessages).toBeUndefined();
    expect(runnerInput?.parentForkContext?.promptEnvelope?.forkContextMessages).toEqual(
      lifecycleModelVisibleMessages,
    );
  });

  it("does not rebuild session summary context from persisted rows when lifecycle fork context is missing", async () => {
    const stateDir = await createRuntimeRoot();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const sessionSummaryRunner = vi.fn().mockResolvedValue({
      status: "no_change",
      writtenCount: 0,
      updatedCount: 0,
    });

    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const runtime = createContextMemoryRuntime({
      runtimeStore: createRuntimeStore(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: {
        ...createRuntimeConfig(),
        durableExtraction: {
          ...createRuntimeConfig().durableExtraction,
          enabled: false,
        },
        sessionSummary: {
          ...createRuntimeConfig().sessionSummary,
          enabled: true,
          minTokensToInit: 1,
          minTokensBetweenUpdates: 1,
          toolCallsBetweenUpdates: 0,
        },
      },
      sessionSummaryRunner,
    });

    const messages = castAgentMessages([
      makeAgentUserMessage({ content: "summarize this session" }),
      makeAgentAssistantMessage({ content: [{ type: "text", text: "done" }] }),
    ]);
    await runtime.afterTurn?.({
      sessionId: "session-missing-lifecycle-fork-context",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session.jsonl",
      messages,
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });

    await emitRunLoopLifecycleEvent({
      phase: "post_sampling",
      runId: "parent-run-missing-fork-context",
      sessionId: "session-missing-lifecycle-fork-context",
      sessionKey: "agent:main:feishu:direct:user-1",
      agentId: "main",
      isTopLevel: true,
      sessionFile: "/tmp/session.jsonl",
      messageCount: messages.length,
      metadata: { prePromptMessageCount: 0 },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sessionSummaryRunner).not.toHaveBeenCalled();
  });

  it("skips stop-phase durable extraction when the turn already wrote durable memory directly", async () => {
    const stateDir = await createRuntimeRoot();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const durableExtractionRunner = createDurableExtractionRunner({
      current: {
        status: "written",
        notes: [
          {
            type: "feedback",
            title: "不应该被写入",
            description: "这条 note 不该在 direct write 回合被后台补写。",
            dedupeKey: "should-not-write",
          },
        ],
      },
    });

    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const runtime = createContextMemoryRuntime({
      runtimeStore: createRuntimeStore(),
      logger,
      config: createRuntimeConfig(),
      durableExtractionRunner,
    });

    await runtime.afterTurn?.({
      sessionId: "session-2",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session.jsonl",
      messages: castAgentMessages([
        makeAgentUserMessage({ content: "记住我喜欢步骤优先。" }),
        makeAgentToolResultMessage({
          toolCallId: "toolcall-1",
          toolName: "memory_note_write",
          content: [{ type: "text", text: "ok" }],
        }),
        makeAgentAssistantMessage({
          content: [{ type: "text", text: "已更新 durable memory，并同步了 MEMORY.md。" }],
        }),
      ]),
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });
    await emitStopPhase({
      sessionId: "session-2",
      sessionKey: "agent:main:feishu:direct:user-1",
      messageCount: 3,
    });
    await drainSharedDurableExtractionWorkers();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const scopeDir = path.join(
      stateDir,
      "durable-memory",
      "agents",
      "main",
      "channels",
      "feishu",
      "users",
      "user-1",
      "60 Preferences",
    );
    await expect(fs.access(path.join(scopeDir, "should-not-write.md"))).rejects.toBeDefined();
    expect(durableExtractionRunner).not.toHaveBeenCalled();
    expect(
      logger.info.mock.calls.some((call) => String(call[0] ?? "").includes("skipped_direct_write")),
    ).toBe(true);
  });

  it("still allows stop-phase durable extraction when the turn already wrote a knowledge note successfully", async () => {
    const stateDir = await createRuntimeRoot();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const durableExtractionRunner = createDurableExtractionRunner({
      current: {
        status: "written",
        notes: [
          {
            type: "reference",
            title: "知识写入后仍可补 durable",
            description: "知识写入成功不应再抑制 stop-phase durable extraction。",
            dedupeKey: "knowledge-duplicate",
          },
        ],
      },
    });

    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const runtime = createContextMemoryRuntime({
      runtimeStore: createRuntimeStore(),
      logger,
      config: createRuntimeConfig(),
      durableExtractionRunner,
    });

    await runtime.afterTurn?.({
      sessionId: "session-knowledge-1",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session.jsonl",
      messages: castAgentMessages([
        makeAgentUserMessage({ content: "把这条 SOP 写进知识库。" }),
        makeAgentToolResultMessage({
          toolCallId: "toolcall-knowledge-1",
          toolName: "write_knowledge_note",
          content: [{ type: "text", text: '{"status":"ok","noteId":"kb-1"}' }],
          details: { status: "ok", noteId: "kb-1" },
        }),
        makeAgentAssistantMessage({
          content: [{ type: "text", text: "知识库已更新，我也会保留必要的 durable memory。" }],
        }),
      ]),
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });
    await emitStopPhase({
      sessionId: "session-knowledge-1",
      sessionKey: "agent:main:feishu:direct:user-1",
      messageCount: 3,
    });
    await drainSharedDurableExtractionWorkers();

    await vi.waitFor(async () => {
      const note = await fs.readFile(
        path.join(
          stateDir,
          "durable-memory",
          "agents",
          "main",
          "channels",
          "feishu",
          "users",
          "user-1",
          "80 References",
          "knowledge-duplicate.md",
        ),
        "utf8",
      );
      expect(note).toContain("知识写入后仍可补 durable");
    });
    expect(durableExtractionRunner).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("skipped_direct_write"));
  });

  it("throttles stop-phase durable extraction when turns arrive too close together", async () => {
    const stateDir = await createRuntimeRoot();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const plan = {
      current: {
        status: "written" as const,
        notes: [
          {
            type: "feedback" as const,
            title: "第一条 durable note",
            description: "第一轮应被写入。",
            dedupeKey: "first-note",
          },
        ],
      },
    };
    const durableExtractionRunner = createDurableExtractionRunner(plan);

    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const runtime = createContextMemoryRuntime({
      runtimeStore: createRuntimeStore(),
      logger,
      config: createRuntimeConfig({ minEligibleTurnsBetweenRuns: 3 }),
      durableExtractionRunner,
    });

    await runtime.afterTurn?.({
      sessionId: "session-3",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session.jsonl",
      messages: castAgentMessages([
        makeAgentUserMessage({ content: "记住第一条 durable note。" }),
        makeAgentAssistantMessage({
          content: [{ type: "text", text: "好的，我会保留这条 durable note。" }],
        }),
      ]),
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });
    await emitStopPhase({
      sessionId: "session-3",
      sessionKey: "agent:main:feishu:direct:user-1",
      messageCount: 2,
    });
    await drainSharedDurableExtractionWorkers();
    await vi.waitFor(async () => {
      await fs.access(
        path.join(
          stateDir,
          "durable-memory",
          "agents",
          "main",
          "channels",
          "feishu",
          "users",
          "user-1",
          "60 Preferences",
          "first-note.md",
        ),
      );
    });

    plan.current = {
      status: "written",
      notes: [
        {
          type: "feedback",
          title: "第二条 durable note",
          description: "第二轮会因为 throttle 跳过。",
          dedupeKey: "second-note",
        },
      ],
    };

    await runtime.afterTurn?.({
      sessionId: "session-3",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session.jsonl",
      messages: castAgentMessages([
        makeAgentUserMessage({ content: "记住第一条 durable note。" }),
        makeAgentUserMessage({ content: "记住第二条 durable note。" }),
        makeAgentAssistantMessage({
          content: [{ type: "text", text: "好的，我会保留第二条 durable note。" }],
        }),
      ]),
      prePromptMessageCount: 2,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });
    await emitStopPhase({
      sessionId: "session-3",
      sessionKey: "agent:main:feishu:direct:user-1",
      messageCount: 3,
      prePromptMessageCount: 2,
    });
    await drainSharedDurableExtractionWorkers();

    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(
      fs.access(
        path.join(
          stateDir,
          "durable-memory",
          "agents",
          "main",
          "channels",
          "feishu",
          "users",
          "user-1",
          "60 Preferences",
          "second-note.md",
        ),
      ),
    ).rejects.toBeDefined();
    expect(durableExtractionRunner).toHaveBeenCalledTimes(1);
    expect(
      logger.info.mock.calls.some((call) => String(call[0] ?? "").includes("skipped_throttle")),
    ).toBe(true);
  });

  it("schedules auto-dream from the lifecycle spine stop phase after a final top-level turn", async () => {
    const stateDir = await createRuntimeRoot();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const submitTurn = vi.fn();
    vi.doMock("../dreaming/auto-dream.ts", () => ({
      getSharedAutoDreamScheduler: () => ({ submitTurn }),
    }));

    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const baseConfig = createRuntimeConfig();
    const runtime = createContextMemoryRuntime({
      runtimeStore: createRuntimeStore(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: {
        ...baseConfig,
        durableExtraction: {
          ...baseConfig.durableExtraction,
          enabled: false,
        },
        dreaming: {
          ...baseConfig.dreaming,
          enabled: true,
        },
      },
      dreamRunner: vi.fn(),
    });

    await runtime.afterTurn?.({
      sessionId: "session-dream-1",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session.jsonl",
      messages: castAgentMessages([
        makeAgentUserMessage({ content: "整理最近几次协作事实。" }),
        makeAgentAssistantMessage({ content: [{ type: "text", text: "这轮已经收口。" }] }),
      ]),
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });
    await emitStopPhase({
      sessionId: "session-dream-1",
      sessionKey: "agent:main:feishu:direct:user-1",
      messageCount: 2,
    });

    expect(submitTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-dream-1",
        sessionKey: "agent:main:feishu:direct:user-1",
      }),
    );
  });

  it("does not schedule auto-dream from ingestion alone before the lifecycle stop phase fires", async () => {
    const stateDir = await createRuntimeRoot();
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const submitTurn = vi.fn();
    vi.doMock("../dreaming/auto-dream.ts", () => ({
      getSharedAutoDreamScheduler: () => ({ submitTurn }),
    }));

    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const baseConfig = createRuntimeConfig();
    const runtime = createContextMemoryRuntime({
      runtimeStore: createRuntimeStore(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: {
        ...baseConfig,
        durableExtraction: {
          ...baseConfig.durableExtraction,
          enabled: false,
        },
        dreaming: {
          ...baseConfig.dreaming,
          enabled: true,
        },
      },
      dreamRunner: vi.fn(),
    });

    await runtime.afterTurn?.({
      sessionId: "session-dream-2",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: "/tmp/session.jsonl",
      messages: castAgentMessages([
        makeAgentUserMessage({ content: "这轮还没结束。" }),
        makeAgentAssistantMessage({
          stopReason: "toolUse",
          content: asAssistantContent([
            { type: "toolUse", id: "call-1", name: "memory_manifest_read", input: {} },
          ]),
        }),
      ]),
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });

    expect(submitTurn).not.toHaveBeenCalled();
  });
});
