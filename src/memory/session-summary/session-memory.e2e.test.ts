import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSessionMemoryCompaction } from "../context/compaction-runner.ts";
import { createContextMemoryRuntime } from "../engine/context-memory-runtime.ts";
import { SqliteRuntimeStore } from "../runtime/sqlite-runtime-store.ts";
import type { MemoryRuntimeConfig } from "../types/config.ts";
import { buildManualSessionSummaryRefreshContext } from "./manual-refresh.ts";
import { SessionSummaryScheduler } from "./scheduler.ts";
import { writeSessionSummaryFile } from "./store.ts";

const { searchNotebookLmViaCliMock, recallDurableMemoryMock } = vi.hoisted(() => ({
  searchNotebookLmViaCliMock: vi.fn().mockResolvedValue([]),
  recallDurableMemoryMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("../notebooklm/notebooklm-cli.ts", () => ({
  searchNotebookLmViaCli: searchNotebookLmViaCliMock,
}));

vi.mock("../durable/read.ts", () => ({
  recallDurableMemory: recallDurableMemoryMock,
}));

const tempDirs: string[] = [];
const stores: SqliteRuntimeStore[] = [];
const previousStateDir = process.env.CRAWCLAW_STATE_DIR;

afterEach(async () => {
  searchNotebookLmViaCliMock.mockClear();
  recallDurableMemoryMock.mockClear();
  await Promise.all(stores.splice(0).map(async (store) => store.close()));
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  if (previousStateDir === undefined) {
    delete process.env.CRAWCLAW_STATE_DIR;
  } else {
    process.env.CRAWCLAW_STATE_DIR = previousStateDir;
  }
});

async function createRuntimeStore(prefix: string): Promise<{
  stateDir: string;
  store: SqliteRuntimeStore;
}> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(stateDir);
  process.env.CRAWCLAW_STATE_DIR = stateDir;
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
      enabled: false,
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

async function appendTurn(params: {
  store: SqliteRuntimeStore;
  sessionId: string;
  turnIndex: number;
  role: "system" | "user" | "assistant" | "toolResult";
  content: string;
}): Promise<void> {
  await params.store.appendMessage({
    sessionId: params.sessionId,
    conversationUid: params.sessionId,
    role: params.role,
    content: params.content,
    contentText: params.content,
    contentBlocks: params.content ? [{ type: "text", text: params.content }] : [],
    turnIndex: params.turnIndex,
    createdAt: 1_774_972_800_000 + params.turnIndex,
  });
}

describe("session memory e2e", () => {
  it("refreshes a session summary from persisted rows with a manual parent fork context", async () => {
    const { store } = await createRuntimeStore("crawclaw-session-memory-refresh-e2e-");
    const sessionId = "session-refresh-e2e";
    await appendTurn({ store, sessionId, turnIndex: 1, role: "system", content: "system only" });
    await appendTurn({ store, sessionId, turnIndex: 2, role: "user", content: "First request" });
    await appendTurn({ store, sessionId, turnIndex: 3, role: "assistant", content: "" });
    await appendTurn({
      store,
      sessionId,
      turnIndex: 4,
      role: "toolResult",
      content: "tool output",
    });
    await appendTurn({
      store,
      sessionId,
      turnIndex: 5,
      role: "assistant",
      content: "Final assistant state",
    });
    const rows = (await store.listMessagesByTurnRange(sessionId, 1, 10)).filter(
      (row) => row.role === "user" || row.role === "assistant" || row.role === "toolResult",
    );
    const manualContext = buildManualSessionSummaryRefreshContext({
      sessionId,
      rows,
    });
    const runner = vi.fn().mockResolvedValue({
      status: "no_change",
      writtenCount: 0,
      updatedCount: 0,
      runId: "summary-e2e-run-1",
    });
    const scheduler = new SessionSummaryScheduler({
      config: {
        enabled: true,
        initialTokenThreshold: 1,
        updateTokenThreshold: 1,
        minToolCalls: 0,
      },
      runtimeStore: store,
      runner,
      logger: console,
    });

    const result = await scheduler.runNow({
      sessionId,
      sessionKey: "agent:main:session-refresh-e2e",
      sessionFile: path.join(os.tmpdir(), "session-refresh-e2e.jsonl"),
      workspaceDir: os.tmpdir(),
      agentId: "main",
      recentMessages: manualContext.recentMessages,
      lastModelVisibleMessageId: manualContext.lastModelVisibleMessageId,
      currentTokenCount: manualContext.currentTokenCount,
      parentForkContext: manualContext.parentForkContext,
      bypassGate: true,
    });

    expect(result).toMatchObject({ status: "no_change", runId: "summary-e2e-run-1" });
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        parentForkContext: expect.objectContaining({
          parentRunId: `manual-session-summary:${sessionId}`,
        }),
      }),
      console,
    );
    const forkMessages = runner.mock.calls[0]?.[0].parentForkContext.promptEnvelope
      .forkContextMessages as AgentMessage[];
    expect(forkMessages.map((message) => (message as { id?: string }).id)).toEqual([
      rows.find((row) => row.role === "user")?.id,
      rows.find((row) => row.contentText === "Final assistant state")?.id,
    ]);
    expect(forkMessages.map((message) => (message as { content?: unknown }).content)).toEqual([
      "First request",
      "Final assistant state",
    ]);
    const state = await store.getSessionSummaryState(sessionId);
    expect(state).toEqual(
      expect.objectContaining({
        lastSummarizedMessageId: rows.find((row) => row.contentText === "Final assistant state")
          ?.id,
        summaryInProgress: false,
      }),
    );
  });

  it("compacts through session summary state and injects the compact summary into prompt assembly", async () => {
    const { stateDir, store } = await createRuntimeStore("crawclaw-session-memory-compact-e2e-");
    const sessionId = "session-compact-e2e";
    const longText = "gateway recovery context with enough tokens ".repeat(20).trim();
    for (let turnIndex = 1; turnIndex <= 8; turnIndex += 1) {
      await appendTurn({
        store,
        sessionId,
        turnIndex,
        role: turnIndex % 2 === 0 ? "assistant" : "user",
        content: `${longText} turn ${turnIndex}`,
      });
    }
    const rows = await store.listMessagesByTurnRange(sessionId, 1, 8);
    const summarizedThroughMessageId = rows[1]?.id ?? null;
    await writeSessionSummaryFile({
      agentId: "main",
      sessionId,
      content: `# Session Summary

> Session: ${sessionId}
> Updated: 2026-04-21T00:00:00.000Z

# Session Title
Gateway recovery

# Current State
Summary-backed compaction captured the earlier gateway recovery plan.

# Open Loops
Keep the latest retry tail and continue from the preserved turn.

# Task specification
Validate session memory end to end.

# Workflow
Use the session summary as the compacted transcript prefix.

# Key results
The prompt should contain a compact summary before the preserved tail.
`,
    });
    await store.upsertSessionSummaryState({
      sessionId,
      lastSummarizedMessageId: summarizedThroughMessageId,
      lastSummaryUpdatedAt: Date.now() - 120_000,
      tokensAtLastSummary: 1_200,
      summaryInProgress: true,
      updatedAt: Date.now() - 120_000,
    });

    const compaction = await runSessionMemoryCompaction({
      runtimeStore: store,
      logger: { info: vi.fn() },
      sessionId,
      agentId: "main",
      tokenBudget: 900,
      currentTokenCount: 1_500,
      force: true,
      runtimeContext: { trigger: "overflow" },
      maxSummaryWaitMs: 10,
    });

    expect(compaction.compacted).toBe(true);
    if (!compaction.compacted) {
      throw new Error(`expected compaction, got ${compaction.reason}`);
    }
    expect(compaction.result.details).toEqual(
      expect.objectContaining({
        staleSummaryLeaseCleared: true,
        summarizedThroughMessageId,
      }),
    );
    const summaryState = await store.getSessionSummaryState(sessionId);
    expect(summaryState?.summaryInProgress).toBe(false);
    const compactionState = await store.getSessionCompactionState(sessionId);
    expect(compactionState?.summaryOverrideText).toContain(
      "Summary-backed compaction captured the earlier gateway recovery plan.",
    );

    const runtime = createContextMemoryRuntime({
      runtimeStore: store,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      config: createMemoryRuntimeConfig(stateDir),
    });
    const messages = rows.map((row) => ({
      id: row.id,
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.contentText || row.content,
      timestamp: row.createdAt,
    })) as unknown as AgentMessage[];
    const assembled = await runtime.assemble({
      sessionId,
      sessionKey: sessionId,
      prompt: "Continue the compacted gateway recovery plan.",
      messages,
      tokenBudget: 900,
      runtimeContext: { agentId: "main" },
    });

    expect((assembled.messages[0] as { subtype?: string }).subtype).toBe("compact_summary");
    expect((assembled.messages[0] as { content?: string }).content).toContain(
      "Summary-backed compaction captured the earlier gateway recovery plan.",
    );
    expect(assembled.messages.slice(1).map((message) => (message as { id?: string }).id)).toEqual(
      rows
        .slice(rows.findIndex((row) => row.id === compactionState?.preservedTailMessageId))
        .map((row) => row.id),
    );
  });
});
