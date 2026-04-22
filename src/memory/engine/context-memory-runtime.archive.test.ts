import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContextArchiveService } from "../../agents/context-archive/service.js";
import { renderQueryContextSections } from "../../agents/query-context/render.js";
import { castAgentMessages } from "../../agents/test-helpers/agent-message-fixtures.js";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { writeSessionSummaryFile } from "../session-summary/store.ts";
import type { MemoryRuntimeConfig } from "../types/config.ts";

function asRuntimeStore(store: Partial<RuntimeStore>): RuntimeStore {
  return store as RuntimeStore;
}

function asContextArchive(
  archive: Pick<ContextArchiveService, "createRun" | "appendEvent">,
): Pick<ContextArchiveService, "createRun" | "appendEvent"> {
  return archive;
}

function createMemoryRuntimeConfig(): MemoryRuntimeConfig {
  return {
    runtimeStore: { type: "sqlite", dbPath: "/tmp/crawclaw-memory.db" },
    contextArchive: {
      mode: "replay",
      rootDir: "/tmp/archive",
      compress: true,
      redactSecrets: true,
      retentionDays: 30,
      maxBlobBytes: 1024 * 1024,
    },
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
      cli: {
        enabled: false,
        command: "python3",
        args: [],
        timeoutMs: 30_000,
        limit: 5,
      },
      write: {
        enabled: false,
        command: "",
        args: [],
        timeoutMs: 30_000,
      },
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

function createArchiveFixture() {
  return {
    createRun: vi.fn().mockResolvedValue({ id: "carun-1" }),
    appendEvent: vi.fn().mockResolvedValue({ id: "caevt-1" }),
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  delete process.env.CRAWCLAW_STATE_DIR;
});

describe("createContextMemoryRuntime() archive capture", () => {
  it("captures model-visible context into the archive service during assemble", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const archive = createArchiveFixture();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-context-archive-summary-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "session-1",
      content: `# Session Summary

> Session: session-1
> Updated: 2026-04-08T00:00:00.000Z

## Session Title
Archive capture

## Current State
verify archive capture

## Task Specification
inspect the archive path

## Key Results
summary file should stay out of assemble
`,
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
      config: createMemoryRuntimeConfig(),
      contextArchive: asContextArchive(archive),
    });

    const result = await runtime.assemble({
      sessionId: "session-1",
      sessionKey: "agent:main:session-1",
      prompt: "how do I inspect the archive?",
      model: "mock-1",
      messages: castAgentMessages([{ role: "user", content: "how do I inspect the archive?" }]),
      tokenBudget: 900,
      runtimeContext: {
        agentId: "main",
      },
    });

    const systemContextText = renderQueryContextSections(result.systemContextSections);
    expect(systemContextText).not.toContain("## Session memory");
    expect(systemContextText).not.toContain("verify archive capture");
    expect(archive.createRun).toHaveBeenCalledTimes(1);
    expect(archive.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        sessionKey: "agent:main:session-1",
        agentId: "main",
        kind: "session",
      }),
    );
    expect(archive.appendEvent).toHaveBeenCalledTimes(1);
    expect(archive.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "carun-1",
        type: "turn.model_visible_context",
        payload: expect.objectContaining({
          model: "mock-1",
          prompt: "how do I inspect the archive?",
          systemContextSections: expect.any(Array),
          systemContextText: expect.any(String),
          messages: [{ role: "user", content: "how do I inspect the archive?" }],
        }),
      }),
    );
  });

  it("does not emit legacy session-summary archive events after new turn ingestion", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const archive = createArchiveFixture();
    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        appendMessage: vi.fn().mockResolvedValue(undefined),
        upsertSessionScope: vi.fn().mockResolvedValue(undefined),
      }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      config: createMemoryRuntimeConfig(),
      contextArchive: asContextArchive(archive),
    });

    await runtime.afterTurn!({
      sessionId: "session-2",
      sessionKey: "agent:main:session-2",
      sessionFile: "/tmp/session-2.jsonl",
      messages: castAgentMessages([{ role: "user", content: "remember this status update" }]),
      prePromptMessageCount: 0,
      runtimeContext: {
        agentId: "main",
      },
    });

    expect(archive.appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "turn.session_summary_update",
      }),
    );
  });

  it("captures compaction outcomes into the archive service", async () => {
    const { createContextMemoryRuntime } = await import("./context-memory-runtime.ts");
    const archive = createArchiveFixture();
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-context-archive-compact-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "session-3",
      content: `# Session Summary

> Session: session-3
> Updated: 2026-04-08T00:00:00.000Z

## Session Title
Compaction test

## Current State
compact me

## Key Results
summary-backed compaction
`,
    });
    const runtime = createContextMemoryRuntime({
      runtimeStore: asRuntimeStore({
        getSessionSummaryState: vi.fn().mockResolvedValue({
          sessionId: "session-3",
          lastSummarizedMessageId: "m6",
          lastSummaryUpdatedAt: Date.now(),
          tokensAtLastSummary: 1200,
          summaryInProgress: false,
          updatedAt: Date.now(),
        }),
        listMessagesByTurnRange: vi.fn().mockResolvedValue([
          { id: "m1", turnIndex: 1, role: "user", content: "a" },
          { id: "m2", turnIndex: 2, role: "assistant", content: "b" },
          { id: "m3", turnIndex: 3, role: "user", content: "c" },
          { id: "m4", turnIndex: 4, role: "assistant", content: "d" },
          { id: "m5", turnIndex: 5, role: "user", content: "e" },
          { id: "m6", turnIndex: 6, role: "assistant", content: "f" },
        ]),
        getSessionCompactionState: vi.fn().mockResolvedValue(null),
        upsertSessionCompactionState: vi.fn().mockResolvedValue(undefined),
        appendCompactionAudit: vi.fn().mockResolvedValue("audit-compact"),
      }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      config: createMemoryRuntimeConfig(),
      contextArchive: asContextArchive(archive),
    });

    await runtime.compact({
      sessionId: "session-3",
      sessionFile: "/tmp/session-3.jsonl",
      tokenBudget: 900,
      currentTokenCount: 1400,
      force: true,
      runtimeContext: {
        agentId: "main",
        sessionKey: "agent:main:session-3",
        trigger: "overflow",
      },
    });

    expect(archive.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "turn.compaction",
        payload: expect.objectContaining({
          sessionId: "session-3",
          trigger: "overflow",
          force: true,
        }),
      }),
    );
  });
});
