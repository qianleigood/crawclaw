import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderQueryContextSections } from "../../agents/query-context/render.js";
import { castAgentMessages } from "../../agents/test-helpers/agent-message-fixtures.js";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { writeSessionSummaryFile } from "../session-summary/store.ts";
import type { MemoryRuntimeConfig } from "../types/config.ts";

function asRuntimeStore(store: Partial<RuntimeStore>): RuntimeStore {
  return store as RuntimeStore;
}

function createBaseMemoryRuntimeConfig(): MemoryRuntimeConfig {
  return {
    runtimeStore: { type: "sqlite", dbPath: "/tmp/crawclaw-memory.db" },
    notebooklm: {
      enabled: false,
      auth: {
        profile: "default",
        cookieFile: "",
        autoRefresh: false,
        statusTtlMs: 60_000,
        degradedCooldownMs: 120_000,
        refreshCooldownMs: 180_000,
        heartbeat: { enabled: false, minIntervalMs: 60_000, maxIntervalMs: 120_000 },
      },
      cli: { enabled: false, command: "python3", args: [], timeoutMs: 30_000, limit: 5 },
      write: { enabled: false, command: "", args: [], timeoutMs: 30_000 },
    },
    skillRouting: { enabled: false, ttlMs: 60_000, shortlistLimit: 4, extraRoots: [] },
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
      storage: {
        cacheDir: "/tmp/crawclaw-memory-media",
        maxAssetBytes: 20 * 1024 * 1024,
      },
    },
    llm: undefined,
    llms: {},
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
    durableExtraction: {
      enabled: false,
      recentMessageLimit: 8,
      maxNotesPerTurn: 2,
      minEligibleTurnsBetweenRuns: 1,
      maxConcurrentWorkers: 2,
      workerIdleTtlMs: 15 * 60_000,
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
      maxWaitMs: 15_000,
      maxTurns: 5,
    },
  };
}

const searchNotebookLmViaCliMock = vi.fn();
const recallDurableMemoryMock = vi.fn();

vi.mock("../notebooklm/notebooklm-cli.ts", () => ({
  searchNotebookLmViaCli: searchNotebookLmViaCliMock,
}));

vi.mock("../durable/read.ts", () => ({
  recallDurableMemory: recallDurableMemoryMock,
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  delete process.env.CRAWCLAW_STATE_DIR;
  delete process.env.CRAWCLAW_MEMORY_DURABLE_PREFETCH_WAIT_MS;
});

describe("createContextMemoryRuntime().assemble", () => {
  it("renders final prompt additions with structured session, optional durable, and chinese knowledge cards", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-session-summary-prompt-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "session-1",
      content: `# Session Summary

> Session: session-1
> Updated: 2026-04-08T00:00:00.000Z

## Session Title
本地网关恢复

## Current State
先判断 durable memory 是否相关

## Task Specification
知识层保持中文卡片化

## Key Results
当前目标：只在相关时注入 durable memory
`,
    });

    searchNotebookLmViaCliMock.mockResolvedValue([
      {
        id: "knowledge:procedure",
        source: "notebooklm",
        title: "本地网关异常恢复",
        summary:
          "在 health 检查失败或 RPC 连接关闭时，先检查网关状态，再确认安装路径，最后重启网关服务并验证健康状态。",
        layer: "sop",
        memoryKind: "procedure",
        retrievalScore: 0.92,
        importance: 0.8,
        canonicalKey: "本地网关异常恢复",
        sourceRef: "notebooklm-note-1",
        metadata: {},
      },
      {
        id: "knowledge:decision",
        source: "notebooklm",
        title: "知识召回改用 NotebookLM",
        summary: "知识层统一走 NotebookLM，可以把写入和读取收口到一个 provider，降低读写分裂。",
        layer: "key_decisions",
        memoryKind: "decision",
        retrievalScore: 0.88,
        importance: 0.78,
        canonicalKey: "知识召回改用 NotebookLM",
        sourceRef: "notebooklm-note-2",
        metadata: {},
      },
    ]);

    recallDurableMemoryMock.mockResolvedValue({
      scope: {
        agentId: "main",
        channel: "feishu",
        userId: "user-42",
        scopeKey: "main:feishu:user-42",
        rootDir: "/tmp/durable",
      },
      manifest: [],
      items: [
        {
          id: "durable:feedback-1",
          source: "native_memory",
          title: "回答操作类问题先给步骤",
          summary: "这个用户偏好操作类问题先给步骤再讲原理。",
          content: "...",
          layer: "preferences",
          durableKind: "feedback",
          durableReasons: ["bucket=durable", "type=feedback"],
          updatedAt: 0,
          score: 1,
          supportingSources: [],
          supportingIds: [],
          metadata: {
            notePath: "feedback-1.md",
            freshnessText:
              "This durable memory is 3 days old. Durable memory is a point-in-time observation, not live state.",
          },
          scoreBreakdown: {
            retrieval: 1,
            sourcePrior: 0,
            layerPrior: 0,
            memoryKindPrior: 0,
            entityBoost: 0,
            keywordBoost: 0,
            exactTitleBoost: 0,
            recencyBoost: 0,
            importanceBoost: 0,
            supportBoost: 0,
            lifecycleBoost: 0,
            mediaBoost: 0,
            penalty: 0,
            finalScore: 1,
          },
        },
      ],
      selection: {
        mode: "llm",
        selectedItemIds: ["durable:feedback-1"],
        omittedItemIds: [],
      },
    });

    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-1"),
      }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      config: {
        ...createBaseMemoryRuntimeConfig(),
        notebooklm: {
          ...createBaseMemoryRuntimeConfig().notebooklm,
          enabled: true,
          cli: {
            enabled: true,
            command: "python3",
            args: [],
            timeoutMs: 30_000,
            limit: 5,
            notebookId: "knowledge-notebook",
          },
          write: {
            enabled: false,
            command: "",
            args: [],
            timeoutMs: 30_000,
            notebookId: "knowledge-notebook",
          },
        },
      },
    });

    const durableRecallPrefetchHandle = await runtime.startDurableRecallPrefetch?.({
      sessionId: "session-1",
      sessionKey: "session-1",
      prompt: "本地网关挂了怎么恢复？",
      messages: castAgentMessages([{ role: "user", content: "本地网关挂了怎么恢复？" }]),
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-42",
      },
    });
    await durableRecallPrefetchHandle?.promise;

    const result = await runtime.assemble({
      sessionId: "session-1",
      sessionKey: "session-1",
      prompt: "本地网关挂了怎么恢复？",
      messages: castAgentMessages([{ role: "user", content: "本地网关挂了怎么恢复？" }]),
      tokenBudget: 900,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-42",
        durableRecallPrefetchHandle,
      },
    });

    const systemContextSections = result.systemContextSections ?? [];
    const systemContextText = renderQueryContextSections(systemContextSections);
    expect(systemContextText).toContain("## Session memory");
    expect(systemContextText).toContain("先判断 durable memory 是否相关");
    expect(systemContextText).toContain("## Durable memory");
    expect(systemContextText).toContain("Feedback memory: 回答操作类问题先给步骤");
    expect(systemContextText).toContain("Freshness:");
    expect(systemContextText).toContain("## 知识回忆");
    expect(systemContextText).toContain("## 操作流程");
    expect(systemContextText).toContain("【操作流程】本地网关异常恢复 适用场景：");
    expect(systemContextText).not.toContain("## 决策说明");
    expect(systemContextText).not.toContain("【决策说明】知识召回改用 NotebookLM");
    const routingContractSection = systemContextSections.find(
      (section) => section.id === "memory:routing_contract",
    );
    expect(routingContractSection?.schema).toMatchObject({
      kind: "routing",
      routingKind: "memory_contract",
    });
    const durableSection = systemContextSections.find((section) => section.id === "memory:durable");
    expect(durableSection?.schema).toMatchObject({
      kind: "durable_memory",
      itemIds: expect.arrayContaining(["durable:feedback-1"]),
    });
  });

  it("consumes a settled durable recall prefetch without re-running synchronous recall", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-session-summary-prefetch-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    searchNotebookLmViaCliMock.mockResolvedValue([]);
    recallDurableMemoryMock.mockReset();

    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-2"),
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: createBaseMemoryRuntimeConfig(),
    });

    const prefetched = {
      scope: {
        agentId: "main",
        channel: "feishu",
        userId: "user-42",
        scopeKey: "main:feishu:user-42",
        rootDir: "/tmp/durable",
      },
      manifest: [],
      items: [
        {
          id: "durable:prefetch-note",
          source: "native_memory",
          title: "Prefetched memory",
          summary: "This was loaded by prefetch.",
          content: "prefetched",
          layer: "preferences",
          durableKind: "feedback",
          durableReasons: ["prefetched"],
          updatedAt: 0,
          score: 1,
          supportingSources: [],
          supportingIds: [],
          scoreBreakdown: {
            retrieval: 1,
            sourcePrior: 0,
            layerPrior: 0,
            memoryKindPrior: 0,
            entityBoost: 0,
            keywordBoost: 0,
            exactTitleBoost: 0,
            recencyBoost: 0,
            importanceBoost: 0,
            supportBoost: 0,
            lifecycleBoost: 0,
            mediaBoost: 0,
            penalty: 0,
            finalScore: 1,
          },
        },
      ],
      selection: {
        mode: "llm" as const,
        selectedItemIds: ["durable:prefetch-note"],
        omittedItemIds: [],
      },
    };

    const result = await runtime.assemble({
      sessionId: "session-prefetch",
      sessionKey: "session-prefetch",
      prompt: "现在按照之前的偏好回答",
      messages: castAgentMessages([{ role: "user", content: "现在按照之前的偏好回答" }]),
      tokenBudget: 900,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-42",
        durableRecallPrefetchHandle: {
          sessionId: "session-prefetch",
          sessionKey: "session-prefetch",
          prompt: "现在按照之前的偏好回答",
          scopeKey: "main:feishu:user-42",
          startedAt: Date.now(),
          status: "fulfilled",
          result: prefetched,
          promise: Promise.resolve(),
        },
      },
    });

    expect(renderQueryContextSections(result.systemContextSections)).toContain("Prefetched memory");
    expect(recallDurableMemoryMock).not.toHaveBeenCalled();
    expect(result.diagnostics?.memoryRecall).toMatchObject({
      durableRecallSource: "prefetch_hit",
      hitReason: "durable_selected:prefetch_hit",
      selectedDurableItemIds: ["durable:prefetch-note"],
    });
  });

  it("falls back to synchronous durable recall when prefetch is still pending after wait window", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");

    searchNotebookLmViaCliMock.mockResolvedValue([]);
    process.env.CRAWCLAW_MEMORY_DURABLE_PREFETCH_WAIT_MS = "1";
    recallDurableMemoryMock.mockReset().mockResolvedValue({
      scope: {
        agentId: "main",
        channel: "feishu",
        userId: "user-42",
        scopeKey: "main:feishu:user-42",
        rootDir: "/tmp/durable",
      },
      manifest: [],
      items: [
        {
          id: "durable:fallback-note",
          source: "native_memory",
          title: "Fallback memory",
          summary: "loaded by sync fallback",
          content: "loaded by sync fallback",
          layer: "preferences",
          durableKind: "feedback",
          durableReasons: ["sync-fallback"],
          updatedAt: 0,
          score: 1,
          supportingSources: [],
          supportingIds: [],
          scoreBreakdown: {
            retrieval: 1,
            sourcePrior: 0,
            layerPrior: 0,
            memoryKindPrior: 0,
            entityBoost: 0,
            keywordBoost: 0,
            exactTitleBoost: 0,
            recencyBoost: 0,
            importanceBoost: 0,
            supportBoost: 0,
            lifecycleBoost: 0,
            mediaBoost: 0,
            penalty: 0,
            finalScore: 1,
          },
        },
      ],
      selection: {
        mode: "heuristic" as const,
        selectedItemIds: ["durable:fallback-note"],
        omittedItemIds: [],
      },
    });

    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-3"),
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: createBaseMemoryRuntimeConfig(),
    });

    const result = await runtime.assemble({
      sessionId: "session-pending",
      sessionKey: "session-pending",
      prompt: "这轮先不阻塞 recall",
      messages: castAgentMessages([{ role: "user", content: "这轮先不阻塞 recall" }]),
      tokenBudget: 900,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-42",
        durableRecallPrefetchHandle: {
          sessionId: "session-pending",
          sessionKey: "session-pending",
          prompt: "这轮先不阻塞 recall",
          scopeKey: "main:feishu:user-42",
          startedAt: Date.now(),
          status: "pending",
          promise: new Promise(() => undefined),
        },
      },
    });

    expect(renderQueryContextSections(result.systemContextSections)).toContain("Fallback memory");
    expect(recallDurableMemoryMock).toHaveBeenCalledTimes(1);
    expect(result.diagnostics?.memoryRecall).toMatchObject({
      durableRecallSource: "prefetch_pending_fallback",
      hitReason: "durable_selected:prefetch_pending_fallback",
      selectedDurableItemIds: ["durable:fallback-note"],
    });
  });

  it("uses prefetch result when pending prefetch settles within the wait window", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    process.env.CRAWCLAW_MEMORY_DURABLE_PREFETCH_WAIT_MS = "50";
    searchNotebookLmViaCliMock.mockResolvedValue([]);
    recallDurableMemoryMock.mockReset();

    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-prefetch-wait-hit"),
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: createBaseMemoryRuntimeConfig(),
    });

    const pendingHandle = {
      sessionId: "session-prefetch-wait-hit",
      sessionKey: "session-prefetch-wait-hit",
      prompt: "等待 prefetch 完成后再组装",
      scopeKey: "main:feishu:user-42",
      startedAt: Date.now(),
      status: "pending" as const,
      result: undefined,
      promise: Promise.resolve(),
    };
    pendingHandle.promise = new Promise<void>((resolve) => {
      setTimeout(() => {
        (pendingHandle as { status: "fulfilled" | "pending" }).status = "fulfilled";
        (
          pendingHandle as {
            result?: {
              scope: {
                agentId: string;
                channel: string;
                userId: string;
                scopeKey: string;
                rootDir: string;
              };
              manifest: [];
              items: Array<Record<string, unknown>>;
              selection: {
                mode: "llm";
                selectedItemIds: string[];
                omittedItemIds: string[];
              };
            };
          }
        ).result = {
          scope: {
            agentId: "main",
            channel: "feishu",
            userId: "user-42",
            scopeKey: "main:feishu:user-42",
            rootDir: "/tmp/durable",
          },
          manifest: [],
          items: [
            {
              id: "durable:prefetch-wait-hit",
              source: "native_memory",
              title: "Wait-hit memory",
              summary: "loaded by settled prefetch",
              content: "loaded by settled prefetch",
              layer: "preferences",
              durableKind: "feedback",
              durableReasons: ["prefetch-wait-hit"],
              updatedAt: 0,
              score: 1,
              supportingSources: [],
              supportingIds: [],
              scoreBreakdown: {
                retrieval: 1,
                sourcePrior: 0,
                layerPrior: 0,
                memoryKindPrior: 0,
                entityBoost: 0,
                keywordBoost: 0,
                exactTitleBoost: 0,
                recencyBoost: 0,
                importanceBoost: 0,
                supportBoost: 0,
                lifecycleBoost: 0,
                mediaBoost: 0,
                penalty: 0,
                finalScore: 1,
              },
            },
          ],
          selection: {
            mode: "llm",
            selectedItemIds: ["durable:prefetch-wait-hit"],
            omittedItemIds: [],
          },
        };
        resolve();
      }, 0);
    });

    const result = await runtime.assemble({
      sessionId: "session-prefetch-wait-hit",
      sessionKey: "session-prefetch-wait-hit",
      prompt: "等待 prefetch 完成后再组装",
      messages: castAgentMessages([{ role: "user", content: "等待 prefetch 完成后再组装" }]),
      tokenBudget: 900,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-42",
        durableRecallPrefetchHandle: pendingHandle,
      },
    });

    expect(renderQueryContextSections(result.systemContextSections)).toContain("Wait-hit memory");
    expect(recallDurableMemoryMock).not.toHaveBeenCalled();
    expect(["prefetch_hit", "prefetch_wait_hit"]).toContain(
      result.diagnostics?.memoryRecall?.durableRecallSource,
    );
    expect(["durable_selected:prefetch_hit", "durable_selected:prefetch_wait_hit"]).toContain(
      result.diagnostics?.memoryRecall?.hitReason,
    );
    expect(result.diagnostics?.memoryRecall?.selectedDurableItemIds).toEqual([
      "durable:prefetch-wait-hit",
    ]);
  });

  it("does not fall back to synchronous durable recall when no prefetch handle is present", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");

    searchNotebookLmViaCliMock.mockResolvedValue([]);
    recallDurableMemoryMock.mockReset().mockResolvedValue({
      scope: {
        agentId: "main",
        channel: "feishu",
        userId: "user-42",
        scopeKey: "main:feishu:user-42",
        rootDir: "/tmp/durable",
      },
      manifest: [],
      items: [
        {
          id: "durable:should-not-appear",
          source: "native_memory",
          title: "Should not appear",
          summary: "sync fallback should be disabled",
          content: "sync fallback should be disabled",
          layer: "preferences",
          durableKind: "feedback",
          durableReasons: ["sync-fallback"],
          updatedAt: 0,
          score: 1,
          supportingSources: [],
          supportingIds: [],
          scoreBreakdown: {
            retrieval: 1,
            sourcePrior: 0,
            layerPrior: 0,
            memoryKindPrior: 0,
            entityBoost: 0,
            keywordBoost: 0,
            exactTitleBoost: 0,
            recencyBoost: 0,
            importanceBoost: 0,
            supportBoost: 0,
            lifecycleBoost: 0,
            mediaBoost: 0,
            penalty: 0,
            finalScore: 1,
          },
        },
      ],
      selection: {
        mode: "heuristic" as const,
        selectedItemIds: ["durable:should-not-appear"],
        omittedItemIds: [],
      },
    });

    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-4"),
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: createBaseMemoryRuntimeConfig(),
    });

    const result = await runtime.assemble({
      sessionId: "session-no-fallback",
      sessionKey: "session-no-fallback",
      prompt: "不要回退成同步 recall",
      messages: castAgentMessages([{ role: "user", content: "不要回退成同步 recall" }]),
      tokenBudget: 900,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-42",
      },
    });

    expect(renderQueryContextSections(result.systemContextSections)).not.toContain(
      "## Durable memory",
    );
    expect(recallDurableMemoryMock).not.toHaveBeenCalled();
  });
});
