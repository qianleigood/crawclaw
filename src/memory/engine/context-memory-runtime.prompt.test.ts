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
  searchNotebookLmViaCliMock.mockReset();
  recallDurableMemoryMock.mockReset();
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  delete process.env.CRAWCLAW_STATE_DIR;
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
        selectedDetails: [
          {
            itemId: "durable:feedback-1",
            notePath: "feedback-1.md",
            title: "回答操作类问题先给步骤",
            provenance: ["header"],
            scoreBreakdown: {
              header: 1.15,
              index: 0,
              bodyIndex: 0,
              bodyRerank: 0,
              dreamBoost: 0,
              final: 1.15,
            },
          },
        ],
        omittedDetails: [],
        recentDreamTouchedNotes: [],
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
      },
    });

    const systemContextSections = result.systemContextSections ?? [];
    const systemContextText = renderQueryContextSections(systemContextSections);
    expect(systemContextText).not.toContain("## Session memory");
    expect(systemContextText).not.toContain("先判断 durable memory 是否相关");
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
    expect(recallDurableMemoryMock).toHaveBeenCalledTimes(1);
    expect(result.diagnostics?.memoryRecall).toMatchObject({
      durableRecallSource: "sync",
      hitReason: "durable_selected:sync",
      selectedDurableItemIds: ["durable:feedback-1"],
      selectedDurableDetails: [
        expect.objectContaining({
          itemId: "durable:feedback-1",
          provenance: expect.arrayContaining(["header"]),
        }),
      ],
    });
  });

  it("reports sync_error when synchronous durable recall fails", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");

    searchNotebookLmViaCliMock.mockResolvedValue([]);
    recallDurableMemoryMock.mockReset().mockRejectedValue(new Error("recall exploded"));

    const warn = vi.fn();
    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-sync-error"),
      }),
      logger: { info: vi.fn(), warn, error: vi.fn() },
      config: createBaseMemoryRuntimeConfig(),
    });

    const result = await runtime.assemble({
      sessionId: "session-sync-error",
      sessionKey: "session-sync-error",
      prompt: "现在按照之前的偏好回答",
      messages: castAgentMessages([{ role: "user", content: "现在按照之前的偏好回答" }]),
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
    expect(recallDurableMemoryMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("durable recall failed"));
    expect(result.diagnostics?.memoryRecall).toMatchObject({
      durableRecallSource: "sync_error",
      hitReason: "durable_unavailable:sync_error",
      selectedDurableItemIds: [],
    });
  });

  it("skips NotebookLM recall for preference prompts based on the knowledge query plan", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");

    searchNotebookLmViaCliMock.mockResolvedValue([
      {
        id: "knowledge:preference-noise",
        source: "notebooklm",
        title: "Preference should not be queried",
        summary: "This should not be fetched for preference-only prompts.",
        layer: "preferences",
        memoryKind: "preference",
        retrievalScore: 0.92,
        importance: 0.8,
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
      items: [],
      selection: {
        mode: "heuristic",
        selectedItemIds: [],
        omittedItemIds: [],
        selectedDetails: [],
        omittedDetails: [],
        recentDreamTouchedNotes: [],
      },
    });

    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-preference-plan"),
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
          },
        },
      },
    });

    const result = await runtime.assemble({
      sessionId: "session-preference-plan",
      sessionKey: "session-preference-plan",
      prompt: "以后默认回答短一点，这是我的偏好",
      messages: castAgentMessages([{ role: "user", content: "以后默认回答短一点，这是我的偏好" }]),
      tokenBudget: 900,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-42",
      },
    });

    expect(searchNotebookLmViaCliMock).not.toHaveBeenCalled();
    expect(result.diagnostics?.memoryRecall?.knowledgeQueryPlan).toMatchObject({
      enabled: false,
      reason: "preference_prefers_durable_memory",
      limit: 0,
    });
  });

  it("uses the knowledge query plan limit for SOP prompts", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");

    searchNotebookLmViaCliMock.mockResolvedValue([]);
    recallDurableMemoryMock.mockResolvedValue({
      scope: {
        agentId: "main",
        channel: "feishu",
        userId: "user-42",
        scopeKey: "main:feishu:user-42",
        rootDir: "/tmp/durable",
      },
      manifest: [],
      items: [],
      selection: {
        mode: "heuristic",
        selectedItemIds: [],
        omittedItemIds: [],
        selectedDetails: [],
        omittedDetails: [],
        recentDreamTouchedNotes: [],
      },
    });

    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-sop-plan"),
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
          },
        },
      },
    });

    const result = await runtime.assemble({
      sessionId: "session-sop-plan",
      sessionKey: "session-sop-plan",
      prompt: "本地网关挂了怎么恢复？给我操作流程",
      messages: castAgentMessages([
        { role: "user", content: "本地网关挂了怎么恢复？给我操作流程" },
      ]),
      tokenBudget: 900,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-42",
      },
    });

    expect(searchNotebookLmViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 7,
      }),
    );
    expect(result.diagnostics?.memoryRecall?.knowledgeQueryPlan).toMatchObject({
      enabled: true,
      reason: "intent:sop",
      limit: 7,
      providerIds: expect.arrayContaining(["notebooklm", "local_knowledge_index"]),
    });
  });

  it("falls back to the local knowledge index when provider recall has no hits", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const { upsertKnowledgeIndexEntry } = await import("../knowledge/index-store.ts");
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-knowledge-index-runtime-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    searchNotebookLmViaCliMock.mockResolvedValue([]);
    recallDurableMemoryMock.mockResolvedValue({
      scope: {
        agentId: "main",
        channel: "feishu",
        userId: "user-42",
        scopeKey: "main:feishu:user-42",
        rootDir: "/tmp/durable",
      },
      manifest: [],
      items: [],
      selection: {
        mode: "heuristic",
        selectedItemIds: [],
        omittedItemIds: [],
        selectedDetails: [],
        omittedDetails: [],
        recentDreamTouchedNotes: [],
      },
    });
    await upsertKnowledgeIndexEntry({
      note: {
        type: "procedure",
        title: "本地网关恢复流程",
        summary: "网关关闭或 health 失败时，先检查端口，再重启服务，最后验证 health。",
        body: "适用于本地网关异常关闭。",
        steps: ["检查端口", "重启服务", "验证 health"],
        dedupeKey: "gateway-recovery-procedure",
      },
      writeResult: {
        status: "ok",
        action: "upsert",
        noteId: "note-gateway",
        title: "本地网关恢复流程",
        notebookId: "knowledge-notebook",
        payloadFile: "/tmp/payload.json",
      },
      updatedAt: 1_000,
    });

    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-local-index"),
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
          },
        },
      },
    });

    const result = await runtime.assemble({
      sessionId: "session-local-index",
      sessionKey: "session-local-index",
      prompt: "本地网关挂了怎么恢复？给我操作流程",
      messages: castAgentMessages([
        { role: "user", content: "本地网关挂了怎么恢复？给我操作流程" },
      ]),
      tokenBudget: 900,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-42",
      },
    });

    const systemContextText = renderQueryContextSections(result.systemContextSections);
    expect(systemContextText).toContain("## 知识回忆");
    expect(systemContextText).toContain("【操作流程】本地网关恢复流程");
    expect(result.diagnostics?.memoryRecall?.knowledgeQueryPlan?.providerIds).toContain(
      "local_knowledge_index",
    );
  });

  it("does not inject session summary into system context during assemble", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-session-summary-workflow-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    searchNotebookLmViaCliMock.mockResolvedValue([]);
    recallDurableMemoryMock.mockReset();

    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "session-workflow",
      content: `# Session Title
Gateway recovery

# Current State
Gateway health checks are failing intermittently.

# Task specification
Recover the local gateway and verify the probe output.

# Files and Functions
src/gateway/run.ts starts the gateway and wires the health checks.

# Workflow
Run crawclaw channels status --probe, inspect the gateway log, clear the stale process, restart the gateway, and rerun the probe.

# Errors & Corrections
Previous attempts failed because the old process still held the port binding.

# Codebase and System Documentation
The gateway owns channel adapters and control-plane routing behind the local runtime boundary.

# Key results
The health probe recovered after the stale process was removed.
`,
    });

    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-workflow"),
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: createBaseMemoryRuntimeConfig(),
    });

    const result = await runtime.assemble({
      sessionId: "session-workflow",
      sessionKey: "session-workflow",
      prompt: "本地网关挂了怎么恢复，给我操作步骤",
      messages: castAgentMessages([
        { role: "user", content: "本地网关挂了怎么恢复，给我操作步骤" },
      ]),
      tokenBudget: 900,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-42",
      },
    });

    const systemContextText = renderQueryContextSections(result.systemContextSections);
    expect(systemContextText).not.toContain("## Session memory");
    expect(systemContextText).not.toContain("Gateway health checks are failing intermittently.");
    expect(systemContextText).not.toContain("Run crawclaw channels status --probe");
    expect(recallDurableMemoryMock).toHaveBeenCalledTimes(1);
  });

  it("does not surface session summary even when durable and knowledge layers are empty", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-session-summary-borrow-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    searchNotebookLmViaCliMock.mockResolvedValue([]);
    recallDurableMemoryMock.mockReset();

    const repeatedWorkflow =
      "Run the probe, inspect the log, kill the stale process, restart the gateway, rerun the probe, and confirm recovery. ".repeat(
        20,
      );

    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "session-borrow",
      content: `# Session Title
Recovery workflow

# Current State
Gateway recovery is blocked on a stale process.

# Task specification
Recover the local gateway and verify probe output.

# Workflow
${repeatedWorkflow}

# Errors & Corrections
Do not restart the gateway before clearing the old process binding.

# Key results
Probe output recovered after the stale process was removed.
`,
    });

    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-borrow"),
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: createBaseMemoryRuntimeConfig(),
    });

    const result = await runtime.assemble({
      sessionId: "session-borrow",
      sessionKey: "session-borrow",
      prompt: "这个网关恢复流程具体怎么走",
      messages: castAgentMessages([{ role: "user", content: "这个网关恢复流程具体怎么走" }]),
      tokenBudget: 900,
      runtimeContext: {
        agentId: "main",
        messageChannel: "feishu",
        senderId: "user-42",
      },
    });

    expect(
      (result.systemContextSections ?? []).find((section) => section.id === "memory:session"),
    ).toBeUndefined();
    expect(renderQueryContextSections(result.systemContextSections)).not.toContain(
      "## Session memory",
    );
    expect(renderQueryContextSections(result.systemContextSections)).not.toContain(
      "## Durable memory",
    );
  });

  it("prepends the compact summary message when a session has compaction state", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-session-summary-compact-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    searchNotebookLmViaCliMock.mockResolvedValue([]);
    recallDurableMemoryMock.mockReset();

    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionCompactionState: vi.fn().mockResolvedValue({
          sessionId: "session-compacted",
          preservedTailStartTurn: 3,
          preservedTailMessageId: "m3",
          summarizedThroughMessageId: "m2",
          mode: "session-summary",
          summaryOverrideText:
            "## Current State\nSummary-backed compaction captured the old gateway work.",
          updatedAt: 1234,
        }),
        appendContextAssemblyAudit: vi.fn().mockResolvedValue("audit-compact-summary"),
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: createBaseMemoryRuntimeConfig(),
    });

    const result = await runtime.assemble({
      sessionId: "session-compacted",
      sessionKey: "session-compacted",
      prompt: "继续网关恢复",
      messages: castAgentMessages([
        { id: "m1", role: "user", content: "旧问题" },
        { id: "m2", role: "assistant", content: "旧处理" },
        { id: "m3", role: "user", content: "保留的 tail" },
        { id: "m4", role: "assistant", content: "继续处理" },
      ]),
      tokenBudget: 900,
      runtimeContext: { agentId: "main" },
    });

    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          subtype: "compact_summary",
          content: expect.stringContaining(
            "Summary-backed compaction captured the old gateway work.",
          ),
        }),
      ]),
    );
    expect(result.messages.map((message) => (message as { id?: string }).id)).toEqual([
      "compact-summary:session-compacted:m2",
      "m3",
      "m4",
    ]);
  });
});
