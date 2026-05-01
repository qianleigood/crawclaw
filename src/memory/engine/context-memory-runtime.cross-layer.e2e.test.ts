import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderQueryContextSections } from "../../agents/query-context/render.js";
import {
  emitRunLoopLifecycleEvent,
  resetRunLoopLifecycleHandlersForTests,
} from "../../agents/runtime/lifecycle/bus.js";
import { buildSpecialAgentCacheEnvelope } from "../../agents/special/runtime/parent-fork-context.js";
import {
  castAgentMessages,
  makeAgentAssistantMessage,
  makeAgentUserMessage,
} from "../../agents/test-helpers/agent-message-fixtures.js";
import { resolveMemoryConfig } from "../config/resolve.ts";
import { runSessionMemoryCompaction } from "../context/compaction-runner.ts";
import type { DreamRunResult } from "../dreaming/agent-runner.ts";
import { __testing as autoDreamTesting } from "../dreaming/auto-dream.ts";
import { __testing as dreamLifecycleTesting } from "../dreaming/lifecycle-subscriber.ts";
import { __testing as durableLifecycleTesting } from "../durable/lifecycle-subscriber.ts";
import { upsertDurableMemoryNote } from "../durable/store.ts";
import {
  __testing as durableWorkerTesting,
  drainSharedDurableExtractionWorkers,
} from "../durable/worker-manager.ts";
import type { DurableExtractionRunResult } from "../durable/worker-manager.ts";
import { upsertExperienceIndexEntry } from "../experience/index-store.ts";
import {
  readExperienceIndexEntries,
  upsertExperienceIndexEntryFromNote,
} from "../experience/index-store.ts";
import { __testing as experienceLifecycleTesting } from "../experience/lifecycle-subscriber.ts";
import {
  __testing as experienceWorkerTesting,
  drainSharedExperienceExtractionWorkers,
} from "../experience/worker-manager.ts";
import type { ExperienceExtractionRunResult } from "../experience/worker-manager.ts";
import { SqliteRuntimeStore } from "../runtime/sqlite-runtime-store.ts";
import { __testing as sessionSummaryLifecycleTesting } from "../session-summary/lifecycle-subscriber.ts";
import { writeSessionSummaryFile } from "../session-summary/store.ts";
import { createContextMemoryRuntime } from "./context-memory-runtime.ts";

vi.mock("../notebooklm/heartbeat.ts", () => ({
  startNotebookLmHeartbeat: vi.fn(),
}));

const searchNotebookLmViaCliMock = vi.hoisted(() => vi.fn());

vi.mock("../notebooklm/notebooklm-cli.ts", () => ({
  searchNotebookLmViaCli: searchNotebookLmViaCliMock,
}));

const tempDirs: string[] = [];
const stores: SqliteRuntimeStore[] = [];
const previousStateDir = process.env.CRAWCLAW_STATE_DIR;
const previousDurableRoot = process.env.CRAWCLAW_DURABLE_MEMORY_DIR;

afterEach(async () => {
  await durableWorkerTesting.resetSharedDurableExtractionWorkerManager();
  await experienceWorkerTesting.resetSharedExperienceExtractionWorkerManager();
  durableLifecycleTesting.resetSharedDurableExtractionLifecycleSubscriber();
  experienceLifecycleTesting.resetSharedExperienceExtractionLifecycleSubscriber();
  dreamLifecycleTesting.resetSharedAutoDreamLifecycleSubscriber();
  autoDreamTesting.resetSharedAutoDreamScheduler();
  sessionSummaryLifecycleTesting.resetSharedSessionSummaryLifecycleSubscriber();
  resetRunLoopLifecycleHandlersForTests();
  searchNotebookLmViaCliMock.mockReset();
  await Promise.all(stores.splice(0).map(async (store) => store.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  if (previousStateDir === undefined) {
    delete process.env.CRAWCLAW_STATE_DIR;
  } else {
    process.env.CRAWCLAW_STATE_DIR = previousStateDir;
  }
  if (previousDurableRoot === undefined) {
    delete process.env.CRAWCLAW_DURABLE_MEMORY_DIR;
  } else {
    process.env.CRAWCLAW_DURABLE_MEMORY_DIR = previousDurableRoot;
  }
  vi.restoreAllMocks();
});

async function createStore(prefix: string): Promise<{
  stateDir: string;
  store: SqliteRuntimeStore;
}> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(stateDir);
  process.env.CRAWCLAW_STATE_DIR = stateDir;
  delete process.env.CRAWCLAW_DURABLE_MEMORY_DIR;
  const store = new SqliteRuntimeStore(path.join(stateDir, "memory-runtime.sqlite"));
  await store.init();
  stores.push(store);
  return { stateDir, store };
}

async function waitForDreamRun(store: SqliteRuntimeStore): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const runs = await store.listRecentMaintenanceRuns(10);
    if (runs.some((run) => run.kind === "dream" && run.status === "done")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for dream maintenance run");
}

function rowsToAgentMessages(
  rows: Awaited<ReturnType<SqliteRuntimeStore["listMessagesByTurnRange"]>>,
): AgentMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.contentText || row.content,
    timestamp: row.createdAt,
  })) as AgentMessage[];
}

describe("context memory runtime cross-layer e2e", () => {
  it("lets the experience agent auto-write an index entry that the next assembly recalls", async () => {
    const { stateDir, store } = await createStore("crawclaw-memory-experience-agent-");
    const sessionId = "session-experience-agent";
    const sessionKey = "agent:main:feishu:direct:user-77";
    const sessionFile = path.join(stateDir, "session.jsonl");
    const config = resolveMemoryConfig({
      runtimeStore: { type: "sqlite", dbPath: path.join(stateDir, "memory-runtime.sqlite") },
      skillRouting: { enabled: false },
      durableExtraction: { enabled: false },
      experience: {
        enabled: true,
        recentMessageLimit: 8,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 2,
        workerIdleTtlMs: 60_000,
      },
      dreaming: { enabled: false },
      notebooklm: {
        enabled: true,
        auth: { heartbeat: { enabled: false } },
        cli: { enabled: true, command: "nlm", notebookId: "experience-notebook" },
        write: { enabled: false },
      },
      sessionSummary: {
        enabled: false,
        rootDir: stateDir,
        minTokensToInit: 10_000,
        minTokensBetweenUpdates: 5_000,
        toolCallsBetweenUpdates: 3,
        maxWaitMs: 10,
        maxTurns: 5,
      },
    });
    const experienceExtractionRunner = vi.fn(async (): Promise<ExperienceExtractionRunResult> => {
      await upsertExperienceIndexEntryFromNote({
        note: {
          type: "failure_pattern",
          title: "网关发布失败顺序经验",
          summary: "网关发布失败时先回滚 service，再验证 secret 和探针输出。",
          context: "发布 gateway 后 health probe 失败。",
          trigger: "gateway 发布失败，probe 返回 unhealthy。",
          action: "先回滚 service，再检查 secret，最后验证 probe。",
          result: "回滚后 probe 恢复 healthy。",
          lesson: "发布失败经验应先保护可恢复路径，再查配置。",
          appliesWhen: "适用于 gateway 发布失败和 service/secret 顺序问题。",
          evidence: ["本轮任务验证了先回滚再查 secret 的顺序。"],
          confidence: "high",
          dedupeKey: "gateway-release-order",
          aliases: ["gateway 发布失败", "gateway release failure"],
        },
        notebookId: "local",
      });
      return {
        status: "written",
        summary: "wrote gateway release failure experience",
        writtenCount: 1,
        updatedCount: 0,
        deletedCount: 0,
        touchedNotes: ["gateway-release-order"],
        advanceCursor: true,
      };
    });
    const runtime = createContextMemoryRuntime({
      runtimeStore: store,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config,
      experienceExtractionRunner,
    });
    const messages = castAgentMessages([
      makeAgentUserMessage({ content: "这次 gateway 发布失败是因为先改 service 再改 secret。" }),
      makeAgentAssistantMessage({
        content: [{ type: "text", text: "已验证：以后先回滚 service，再检查 secret 和 probe。" }],
      }),
    ]);

    await runtime.afterTurn?.({
      sessionId,
      sessionKey,
      sessionFile,
      messages,
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-77" },
    });
    await emitRunLoopLifecycleEvent({
      phase: "stop",
      sessionId,
      sessionKey,
      agentId: "main",
      isTopLevel: true,
      sessionFile,
      messageCount: messages.length,
      metadata: {
        prePromptMessageCount: 0,
        messageChannel: "feishu",
        senderId: "user-77",
        workspaceDir: stateDir,
      },
    });
    await drainSharedExperienceExtractionWorkers();

    expect(experienceExtractionRunner).toHaveBeenCalledTimes(1);
    expect((await readExperienceIndexEntries()).map((entry) => entry.id)).toContain(
      "experience-index:gateway-release-order",
    );
    searchNotebookLmViaCliMock.mockResolvedValue([
      {
        id: "notebooklm:gateway-release-order",
        source: "notebooklm",
        title: "网关发布失败顺序经验",
        summary: "网关发布失败时先回滚 service，再验证 secret 和探针输出。",
        layer: "sop",
        memoryKind: "procedure",
        retrievalScore: 0.1,
        metadata: {},
      },
    ]);
    const rowsForAssembly = await store.listMessagesByTurnRange(sessionId, 1, messages.length);
    const assembled = await runtime.assemble({
      sessionId,
      sessionKey,
      prompt: "给我 gateway release failure SOP runbook，说明发布失败后应该怎么处理。",
      messages: rowsToAgentMessages(rowsForAssembly),
      tokenBudget: 1_000,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-77" },
    });
    expect(assembled.diagnostics?.memoryRecall?.selectedExperienceItemIds).toContain(
      "notebooklm:gateway-release-order",
    );
    expect(renderQueryContextSections(assembled.systemContextSections)).toContain(
      "网关发布失败顺序经验",
    );
  });

  it("connects session compaction, durable extraction, dream feedback, experience recall, and assembly diagnostics", async () => {
    const { stateDir, store } = await createStore("crawclaw-memory-cross-layer-");
    const sessionId = "session-cross-layer";
    const sessionKey = "agent:main:feishu:direct:user-42";
    const sessionFile = path.join(stateDir, "session.jsonl");

    const config = resolveMemoryConfig({
      runtimeStore: { type: "sqlite", dbPath: path.join(stateDir, "memory-runtime.sqlite") },
      skillRouting: { enabled: false },
      durableExtraction: {
        enabled: true,
        recentMessageLimit: 8,
        maxNotesPerTurn: 2,
        minEligibleTurnsBetweenRuns: 1,
        maxConcurrentWorkers: 2,
        workerIdleTtlMs: 60_000,
      },
      dreaming: {
        minHours: 0,
        minSessions: 1,
        scanThrottleMs: 0,
        lockStaleAfterMs: 60_000,
      },
      notebooklm: {
        enabled: true,
        auth: { heartbeat: { enabled: false } },
        cli: { enabled: true, command: "nlm", notebookId: "experience-notebook" },
        write: { enabled: false },
      },
      sessionSummary: {
        enabled: false,
        rootDir: stateDir,
        minTokensToInit: 10_000,
        minTokensBetweenUpdates: 5_000,
        toolCallsBetweenUpdates: 3,
        maxWaitMs: 10,
        maxTurns: 5,
      },
    });

    expect(config.dreaming.enabled).toBe(true);

    const durableExtractionRunner = vi.fn(async (params): Promise<DurableExtractionRunResult> => {
      await upsertDurableMemoryNote({
        scope: params.scope,
        input: {
          type: "feedback",
          title: "step-first answer preference",
          description: "For operation questions, the user prefers step-first answers.",
          body: "When the user asks for a gateway-recovery procedure, answer with concrete steps first, then explain the reasoning.",
          dedupeKey: "step-first",
        },
      });
      return {
        status: "written",
        notesSaved: 1,
        reason: "saved step-first durable memory",
        advanceCursor: true,
      };
    });
    const dreamRunner = vi.fn(async (params): Promise<DreamRunResult> => {
      await upsertDurableMemoryNote({
        scope: params.scope,
        input: {
          type: "feedback",
          title: "step-first answer preference",
          description: "Dream consolidated that gateway-recovery answers should start with steps.",
          body: "Prefer a step-first gateway-recovery response, then include verification commands and caveats.",
          dedupeKey: "step-first",
        },
      });
      return {
        status: "written",
        summary: "dream consolidated step-first durable memory",
        writtenCount: 0,
        updatedCount: 1,
        deletedCount: 0,
        touchedNotes: ["60 Preferences/step-first.md"],
      };
    });

    await upsertExperienceIndexEntry({
      note: {
        type: "procedure",
        title: "gateway-recovery 恢复经验",
        summary: "gateway-recovery 场景要按检查状态、查看日志、重启网关、验证探针的顺序处理。",
        context: "用户要求 gateway-recovery procedure 或 runbook-style prompt。",
        action: "先检查状态，再查看日志，然后重启网关，最后验证探针输出。",
        lesson: "恢复类请求要先给步骤，再结合 step-first recall signal 调整回答顺序。",
        evidence: ["gateway-recovery probe output healthy"],
        aliases: ["gateway-recovery", "gateway recovery", "gateway-recovery procedure"],
        tags: ["gateway-recovery", "procedure", "experience"],
        dedupeKey: "gateway-recovery",
      },
      writeResult: {
        status: "ok",
        action: "upsert",
        notebookId: "local-baseline",
        noteId: "gateway-recovery-note",
        title: "gateway-recovery 恢复经验",
        payloadFile: path.join(stateDir, "experience-payload.json"),
      },
    });

    const runtime = createContextMemoryRuntime({
      runtimeStore: store,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config,
      durableExtractionRunner,
      dreamRunner,
    });

    const longGatewayContext =
      "gateway recovery status logs restart verify step-first operations procedure ".repeat(24);
    const messages = castAgentMessages([
      makeAgentUserMessage({
        content: `We need a gateway-recovery procedure. ${longGatewayContext}`,
      }),
      makeAgentAssistantMessage({
        content: [
          {
            type: "text",
            text: `I will keep gateway-recovery state organized. ${longGatewayContext}`,
          },
        ],
      }),
      makeAgentUserMessage({
        content: `Remember: for operation questions, answer step-first. ${longGatewayContext}`,
      }),
      makeAgentAssistantMessage({
        content: [
          {
            type: "text",
            text: `I will answer operation questions step-first. ${longGatewayContext}`,
          },
        ],
      }),
      makeAgentUserMessage({
        content: `Check status, inspect logs, restart, then verify. ${longGatewayContext}`,
      }),
      makeAgentAssistantMessage({
        content: [
          {
            type: "text",
            text: `That is the gateway-recovery runbook tail. ${longGatewayContext}`,
          },
        ],
      }),
      makeAgentUserMessage({
        content: `Keep the latest retry tail after compaction. ${longGatewayContext}`,
      }),
      makeAgentAssistantMessage({
        content: [
          {
            type: "text",
            text: `I will preserve the recent retry tail. ${longGatewayContext}`,
          },
        ],
      }),
    ]);

    await runtime.afterTurn?.({
      sessionId,
      sessionKey,
      sessionFile,
      messages,
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-42" },
    });
    const persistedRows = await store.listMessagesByTurnRange(sessionId, 1, messages.length);
    await writeSessionSummaryFile({
      agentId: "main",
      sessionId,
      content: `# Session Title
Gateway recovery memory e2e

# Current State
Summary-backed compaction captured the earlier gateway-recovery context.

# Open Loops
Continue from the preserved retry tail and keep step-first answer behavior.

# Task specification
Validate that session, durable, dream, and experience memory all feed the next assembly.

# Workflow
Use gateway-recovery steps, then verify the probe output.

# Key results
The compact summary should appear before the preserved tail.
`,
    });
    await store.upsertSessionSummaryState({
      sessionId,
      lastSummarizedMessageId: persistedRows[1]?.id ?? null,
      lastSummaryUpdatedAt: Date.now(),
      tokensAtLastSummary: 1_200,
      summaryInProgress: false,
    });

    const compaction = await runSessionMemoryCompaction({
      runtimeStore: store,
      logger: { info: vi.fn() },
      sessionId,
      agentId: "main",
      totalTurns: persistedRows.length,
      tokenBudget: 900,
      currentTokenCount: 1_500,
      force: true,
      runtimeContext: { trigger: "manual" },
      maxSummaryWaitMs: 10,
    });
    expect(compaction.compacted).toBe(true);

    const parentForkContext = {
      parentRunId: "parent-cross-layer",
      provider: "openai",
      modelId: "gpt-5.4",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "parent system prompt",
        toolNames: ["memory_manifest_read"],
        toolPromptPayload: [{ name: "memory_manifest_read" }],
        thinkingConfig: {},
        forkContextMessages: messages,
      }),
    };

    await emitRunLoopLifecycleEvent({
      phase: "stop",
      sessionId,
      sessionKey,
      agentId: "main",
      isTopLevel: true,
      sessionFile,
      messageCount: messages.length,
      metadata: {
        prePromptMessageCount: 2,
        messageChannel: "feishu",
        senderId: "user-42",
        workspaceDir: stateDir,
        parentForkContext,
      },
    });
    await drainSharedDurableExtractionWorkers();
    await waitForDreamRun(store);

    expect(durableExtractionRunner).toHaveBeenCalledTimes(1);
    expect(dreamRunner).toHaveBeenCalledTimes(1);

    const maintenanceRuns = await store.listRecentMaintenanceRuns(5);
    const dreamRun = maintenanceRuns.find((run) => run.kind === "dream");
    expect(dreamRun?.metricsJson).toContain("60 Preferences/step-first.md");

    const rowsForAssembly = await store.listMessagesByTurnRange(sessionId, 1, messages.length);
    searchNotebookLmViaCliMock.mockResolvedValue([
      {
        id: "notebooklm:gateway-recovery",
        source: "notebooklm",
        title: "gateway-recovery 恢复经验",
        summary: "gateway-recovery 场景要按检查状态、查看日志、重启网关、验证探针的顺序处理。",
        layer: "sop",
        memoryKind: "procedure",
        retrievalScore: 0.1,
        metadata: {},
      },
    ]);
    const assembled = await runtime.assemble({
      sessionId,
      sessionKey,
      prompt: "Give me the gateway-recovery procedure with the step-first preference.",
      messages: rowsToAgentMessages(rowsForAssembly),
      tokenBudget: 1_100,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-42" },
    });

    expect((assembled.messages[0] as { subtype?: string }).subtype).toBe("compact_summary");
    expect((assembled.messages[0] as { content?: string }).content).toContain(
      "Summary-backed compaction captured the earlier gateway-recovery context.",
    );
    const diagnostics = assembled.diagnostics?.memoryRecall;
    expect(diagnostics?.selectedDurableItemIds).toContain("durable:60 Preferences/step-first.md");
    expect(diagnostics?.recentDreamTouchedNotes).toContain("60 Preferences/step-first.md");
    expect(diagnostics?.selectedDurableDetails?.[0]?.provenance).toContain("dream_boost");
    expect(diagnostics?.selectedExperienceItemIds).toEqual(
      expect.arrayContaining(["notebooklm:gateway-recovery"]),
    );
    expect(diagnostics?.experienceQueryPlan).toMatchObject({
      enabled: true,
      reason: "intent:sop",
    });
    const systemContextText = renderQueryContextSections(assembled.systemContextSections);
    expect(systemContextText).toContain("## Durable memory");
    expect(systemContextText).toContain("## 经验回忆");
    expect(systemContextText).toContain("gateway-recovery 恢复经验");
  });
});
