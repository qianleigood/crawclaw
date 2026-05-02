import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEmbeddedPiAgentParams } from "../../agents/pi-embedded-runner/run/params.ts";
import type { EmbeddedPiRunResult } from "../../agents/pi-embedded-runner/types.ts";
import { emitRunLoopLifecycleEvent } from "../../agents/runtime/lifecycle/bus.js";
import { resetRunLoopLifecycleHandlersForTests } from "../../agents/runtime/lifecycle/bus.ts";
import { buildSpecialAgentCacheEnvelope } from "../../agents/special/runtime/parent-fork-context.js";
import {
  castAgentMessages,
  makeAgentAssistantMessage,
  makeAgentUserMessage,
} from "../../agents/test-helpers/agent-message-fixtures.js";
import { createMemoryNoteWriteTool } from "../../agents/tools/memory-file-tools.ts";
import { createContextMemoryRuntime } from "../engine/context-memory-runtime.ts";
import { SqliteRuntimeStore } from "../runtime/sqlite-runtime-store.ts";
import type { MemoryRuntimeConfig } from "../types/config.ts";
import { __testing as durableAgentTesting, runDurableMemoryAgentOnce } from "./agent-runner.ts";
import { __testing as lifecycleTesting } from "./lifecycle-subscriber.ts";
import { scanDurableMemoryManifest } from "./manifest.ts";
import {
  __testing as workerTesting,
  drainSharedDurableExtractionWorkers,
} from "./worker-manager.ts";

vi.mock("../notebooklm/heartbeat.ts", () => ({
  startNotebookLmHeartbeat: vi.fn(),
}));

vi.mock("../notebooklm/notebooklm-cli.ts", () => ({
  searchNotebookLmViaCli: vi.fn().mockResolvedValue([]),
}));

const tempDirs: string[] = [];
const stores: SqliteRuntimeStore[] = [];
const previousStateDir = process.env.CRAWCLAW_STATE_DIR;
const previousDurableRoot = process.env.CRAWCLAW_DURABLE_MEMORY_DIR;

afterEach(async () => {
  await workerTesting.resetSharedDurableExtractionWorkerManager();
  lifecycleTesting.resetSharedDurableExtractionLifecycleSubscriber();
  resetRunLoopLifecycleHandlersForTests();
  durableAgentTesting.setDepsForTest();
  await Promise.all(stores.splice(0).map(async (store) => store.close()));
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })),
  );
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

async function createRuntimeStore(prefix: string): Promise<{
  stateDir: string;
  store: SqliteRuntimeStore;
}> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(stateDir);
  process.env.CRAWCLAW_STATE_DIR = stateDir;
  delete process.env.CRAWCLAW_DURABLE_MEMORY_DIR;
  const store = new SqliteRuntimeStore(path.join(stateDir, "runtime.sqlite"));
  await store.init();
  stores.push(store);
  return { stateDir, store };
}

function createMemoryRuntimeConfig(stateDir: string): MemoryRuntimeConfig {
  return {
    runtimeStore: { type: "sqlite", dbPath: path.join(stateDir, "runtime.sqlite") },
    notebooklm: {
      enabled: false,
      auth: {
        profile: "default",
        cookieFile: "",
        statusTtlMs: 60_000,
        degradedCooldownMs: 120_000,
        refreshCooldownMs: 180_000,
        heartbeat: { enabled: false, minIntervalMs: 60_000, maxIntervalMs: 120_000 },
      },
      cli: { enabled: false, command: "python3", args: [], timeoutMs: 30_000, limit: 5 },
      write: { command: "", args: [], timeoutMs: 30_000 },
    },
    skillRouting: { enabled: false, ttlMs: 60_000, shortlistLimit: 4, extraRoots: [] },
    automation: {
      enabled: false,
      maxJobAttempts: 3,
      schedulerPollIntervalMs: 15_000,
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
      storage: { cacheDir: path.join(stateDir, "media"), maxAssetBytes: 20 * 1024 * 1024 },
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
      enabled: true,
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
      rootDir: path.join(stateDir, "session-summary"),
      minTokensToInit: 10_000,
      minTokensBetweenUpdates: 5_000,
      toolCallsBetweenUpdates: 3,
      maxWaitMs: 15_000,
      maxTurns: 5,
    },
  };
}

function createFakeExtractorRun(params: { capturedEmbeddedRuns: RunEmbeddedPiAgentParams[] }) {
  return vi.fn(async (embeddedParams: RunEmbeddedPiAgentParams): Promise<EmbeddedPiRunResult> => {
    params.capturedEmbeddedRuns.push(embeddedParams);
    expect(embeddedParams.specialAgentSpawnSource).toBe("durable-memory");
    expect(embeddedParams.specialDurableMemoryScope).toEqual({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    expect(embeddedParams.prompt).toContain(
      "Analyze the most recent ~2 model-visible messages above",
    );
    expect(embeddedParams.prompt).not.toContain(
      "Recent model-visible messages since the last extraction cursor:",
    );
    expect(embeddedParams.prompt).not.toContain("旧上下文：我只想要中文回答。");
    expect(embeddedParams.specialParentPromptEnvelope?.forkContextMessages).toHaveLength(4);

    const writeTool = createMemoryNoteWriteTool({
      scope: embeddedParams.specialDurableMemoryScope,
    });
    expect(writeTool).not.toBeNull();
    await writeTool!.execute("write-note", {
      notePath: "60 Preferences/step-first-answers.md",
      content: [
        "---",
        'type: "feedback"',
        'title: "回答先给步骤"',
        'description: "用户偏好操作类问题先给步骤。"',
        'dedupe_key: "step-first-answers"',
        "---",
        "",
        "默认先给可执行步骤，再补充解释。",
      ].join("\n"),
    });
    await writeTool!.execute("write-index", {
      notePath: "MEMORY.md",
      content:
        "# MEMORY.md\n\n## feedback\n- [回答先给步骤](./60 Preferences/step-first-answers.md) — 用户偏好操作类问题先给步骤。\n",
    });

    return {
      payloads: [
        {
          text: [
            "STATUS: WRITTEN",
            "SUMMARY: saved durable step-first preference",
            "WRITTEN_COUNT: 1",
            "UPDATED_COUNT: 0",
            "DELETED_COUNT: 0",
          ].join("\n"),
        },
      ],
      meta: {
        durationMs: 10,
        agentMeta: {
          sessionId: embeddedParams.sessionId,
          provider: embeddedParams.provider ?? "openai",
          model: embeddedParams.model ?? "gpt-5.4",
          usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, total: 120 },
        },
      },
    };
  });
}

describe("durable extraction agent e2e", () => {
  it("runs from stop lifecycle through the embedded durable memory agent and scoped durable files", async () => {
    const { stateDir, store } = await createRuntimeStore("crawclaw-durable-extraction-e2e-");
    const capturedEmbeddedRuns: RunEmbeddedPiAgentParams[] = [];
    const runEmbeddedPiAgent = createFakeExtractorRun({ capturedEmbeddedRuns });
    durableAgentTesting.setDepsForTest({ runEmbeddedPiAgent });

    const runtime = createContextMemoryRuntime({
      runtimeStore: store,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: createMemoryRuntimeConfig(stateDir),
      durableExtractionRunner: runDurableMemoryAgentOnce,
    });
    const messages = castAgentMessages([
      makeAgentUserMessage({ content: "旧上下文：我只想要中文回答。" }),
      makeAgentAssistantMessage({
        content: [{ type: "text", text: "收到，我会用中文回答。" }],
      }),
      makeAgentUserMessage({ content: "以后操作类回答先给步骤。" }),
      makeAgentAssistantMessage({
        content: [{ type: "text", text: "好的，以后会先给步骤，再补充解释。" }],
      }),
    ]);
    const parentForkContext = {
      parentRunId: "parent-run-extraction-e2e",
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

    await runtime.afterTurn?.({
      sessionId: "session-extraction-e2e",
      sessionKey: "agent:main:feishu:direct:user-1",
      sessionFile: path.join(stateDir, "session.jsonl"),
      messages,
      prePromptMessageCount: 2,
      runtimeContext: { agentId: "main", messageChannel: "feishu", senderId: "user-1" },
    });

    await emitRunLoopLifecycleEvent({
      phase: "stop",
      sessionId: "session-extraction-e2e",
      sessionKey: "agent:main:feishu:direct:user-1",
      agentId: "main",
      isTopLevel: true,
      sessionFile: path.join(stateDir, "session.jsonl"),
      messageCount: messages.length,
      metadata: {
        prePromptMessageCount: 2,
        messageChannel: "feishu",
        senderId: "user-1",
        workspaceDir: stateDir,
        parentForkContext,
      },
    });
    await drainSharedDurableExtractionWorkers();

    expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    await runEmbeddedPiAgent.mock.results[0]?.value;
    await drainSharedDurableExtractionWorkers();
    expect(capturedEmbeddedRuns[0]?.sessionKey).toMatch(/^embedded:durable_memory:/);
    const notePath = path.join(
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
    );
    await expect(fs.readFile(notePath, "utf8")).resolves.toContain("默认先给可执行步骤");
    const indexPath = path.join(
      stateDir,
      "durable-memory",
      "agents",
      "main",
      "channels",
      "feishu",
      "users",
      "user-1",
      "MEMORY.md",
    );
    await expect(fs.readFile(indexPath, "utf8")).resolves.toContain("回答先给步骤");

    const manifest = await scanDurableMemoryManifest({
      scope: {
        agentId: "main",
        channel: "feishu",
        userId: "user-1",
        rootDir: path.dirname(indexPath),
      },
    });
    expect(manifest).toEqual([
      expect.objectContaining({
        notePath: "60 Preferences/step-first-answers.md",
        title: "回答先给步骤",
        durableType: "feedback",
        indexHook: expect.stringContaining("用户偏好操作类问题先给步骤"),
      }),
    ]);
    await expect(store.getDurableExtractionCursor("session-extraction-e2e")).resolves.toMatchObject(
      {
        sessionId: "session-extraction-e2e",
        sessionKey: "agent:main:feishu:direct:user-1",
        lastExtractedTurn: 4,
      },
    );
  });
});
