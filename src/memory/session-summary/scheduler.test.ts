import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSummaryScheduler, evaluateSessionSummaryGate } from "./scheduler.js";
import { writeSessionSummaryFile } from "./store.js";

describe("session summary scheduler gate", () => {
  const tempDirs: string[] = [];
  const previousStateDir = process.env.CRAWCLAW_STATE_DIR;

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    if (previousStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = previousStateDir;
    }
  });

  it("blocks when disabled", () => {
    const gate = evaluateSessionSummaryGate({
      enabled: false,
      sessionKey: "agent:main:main",
      currentTokenCount: 12_000,
      summaryText: "",
    });
    expect(gate.ready).toBe(false);
    expect(gate.reason).toBe("disabled");
  });

  it("blocks the first run until the initial threshold is met", () => {
    const gate = evaluateSessionSummaryGate({
      enabled: true,
      sessionKey: "agent:main:main",
      currentTokenCount: 2_999,
      summaryText: "",
    });
    expect(gate.ready).toBe(false);
    expect(gate.reason).toBe("below_initial_token_threshold");
  });

  it("allows an early lightweight summary once the light threshold is met", () => {
    const gate = evaluateSessionSummaryGate({
      enabled: true,
      sessionKey: "agent:main:main",
      isSettledTurn: true,
      currentTokenCount: 3_000,
      summaryText: "",
      lightInitialTokenThreshold: 3_000,
      initialTokenThreshold: 10_000,
    });
    expect(gate.ready).toBe(true);
    expect(gate.reason).toBe("ready");
  });

  it("allows an update only when the token delta threshold is met", () => {
    const gate = evaluateSessionSummaryGate({
      enabled: true,
      sessionKey: "agent:main:main",
      currentTokenCount: 17_000,
      summaryText: "# Session Title\n_Title_\n\n# Current State\n_State_\n\nWorking\n",
      toolCallCount: 3,
      lastSummaryUpdatedAt: Date.now() - 60_000,
      updateTokenThreshold: 5_000,
      minToolCalls: 3,
    });
    expect(gate.ready).toBe(true);
    expect(gate.reason).toBe("ready");
  });

  it("keeps the token threshold mandatory even if tool calls are high", () => {
    const gate = evaluateSessionSummaryGate({
      enabled: true,
      sessionKey: "agent:main:main",
      currentTokenCount: 1_200,
      summaryText: "# Session Title\n_Title_\n\n# Current State\n_State_\n\nWorking\n",
      toolCallCount: 5,
      updateTokenThreshold: 5_000,
      minToolCalls: 3,
    });
    expect(gate.ready).toBe(false);
    expect(gate.reason).toBe("below_update_token_threshold");
  });

  it("allows a non-settled post-sampling update once token and tool-call thresholds are both met", () => {
    const gate = evaluateSessionSummaryGate({
      enabled: true,
      sessionKey: "agent:main:main",
      isSettledTurn: false,
      currentTokenCount: 17_000,
      summaryText: "# Session Title\n_Title_\n\n# Current State\n_State_\n\nWorking\n",
      stateSummaryTokenCount: 10_000,
      toolCallCount: 3,
      updateTokenThreshold: 5_000,
      minToolCalls: 3,
    });
    expect(gate.ready).toBe(true);
    expect(gate.reason).toBe("ready");
  });

  it("allows a light summary to expand into a full summary once the full threshold is reached", () => {
    const gate = evaluateSessionSummaryGate({
      enabled: true,
      sessionKey: "agent:main:main",
      currentTokenCount: 10_000,
      summaryText: "# Session Title\n_Title_\n\n# Current State\n_State_\n\nWorking\n",
      stateSummaryTokenCount: 9_800,
      toolCallCount: 0,
      isSettledTurn: true,
      updateTokenThreshold: 5_000,
      initialTokenThreshold: 10_000,
      requiresFullUpgrade: true,
    });
    expect(gate.ready).toBe(true);
    expect(gate.reason).toBe("ready");
  });

  it("threads parentRunId into the session summary runner", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-session-summary-scheduler-"),
    );
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const runtimeStore = {
      getSessionSummaryState: vi.fn().mockResolvedValue(null),
      upsertSessionSummaryState: vi.fn().mockResolvedValue(undefined),
    };
    const runner = vi.fn().mockResolvedValue({
      status: "no_change",
      writtenCount: 0,
      updatedCount: 0,
      runId: "summary-run-1",
    });
    const scheduler = new SessionSummaryScheduler({
      config: {
        enabled: true,
        initialTokenThreshold: 1,
        updateTokenThreshold: 1,
        minToolCalls: 0,
      },
      runtimeStore: runtimeStore as never,
      runner,
      logger: console,
    });

    const result = await scheduler.runNow({
      sessionId: "session-1",
      sessionKey: "agent:main:main",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: "/tmp/workspace",
      agentId: "main",
      parentRunId: "parent-run-1",
      recentMessages: [{ role: "assistant", content: "summarize this" }] as never,
      lastModelVisibleMessageId: "msg-1",
      recentMessageLimit: 8,
      currentTokenCount: 12_000,
      toolCallCount: 3,
      isSettledTurn: true,
      bypassGate: true,
      currentSummary: null,
    });

    expect(result).toMatchObject({ status: "started", runId: "summary-run-1" });
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        sessionFile: "/tmp/session-1.jsonl",
        workspaceDir: "/tmp/workspace",
        parentRunId: "parent-run-1",
      }),
      console,
    );
  });

  it("returns promotion results after a successful summary refresh", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-session-summary-promotion-"),
    );
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    await writeSessionSummaryFile({
      agentId: "main",
      sessionId: "session-1",
      content: `# Session Title
_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_

Memory refactor

# Current State
_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._

Finish the durable bridge.

# Open Loops
_Which work items, decisions, or follow-ups are still open right now? Keep this tightly focused on unresolved items._

Need to keep transcript priority explicit.

# Task specification
_What did the user ask to build? Any design decisions or other explanatory context_

Make session summary compaction-first.

# Workflow
_What bash commands are usually run and in what order? How to interpret their output if not obvious?_

Run pnpm test for session summary files, then pnpm build.

# Errors & Corrections
_Errors encountered and how they were fixed. What did the user correct? What approaches failed and should not be tried again?_

Do not reintroduce prompt-time session summary injection; keep summary compaction-first.

# Key results
_If the user asked a specific output such as an answer to a question, a table, or other document, repeat the exact result here_

Session summary now starts with a light profile before upgrading to full.
`,
    });
    const runtimeStore = {
      getSessionSummaryState: vi.fn().mockResolvedValue(null),
      upsertSessionSummaryState: vi.fn().mockResolvedValue(undefined),
      listRecentPromotionCandidates: vi.fn().mockResolvedValue([]),
      createPromotionCandidate: vi.fn().mockResolvedValue("candidate-1"),
      updatePromotionCandidate: vi.fn().mockResolvedValue(undefined),
    };
    const runner = vi.fn().mockResolvedValue({
      status: "no_change",
      writtenCount: 0,
      updatedCount: 0,
      runId: "summary-run-2",
    });
    const scheduler = new SessionSummaryScheduler({
      config: {
        enabled: true,
        initialTokenThreshold: 1,
        updateTokenThreshold: 1,
        minToolCalls: 0,
      },
      runtimeStore: runtimeStore as never,
      runner,
      logger: console,
    });

    const result = await scheduler.runNow({
      sessionId: "session-1",
      sessionKey: "agent:main:main",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: "/tmp/workspace",
      agentId: "main",
      recentMessages: [{ role: "assistant", content: "summarize this" }] as never,
      lastModelVisibleMessageId: "msg-1",
      recentMessageLimit: 8,
      currentTokenCount: 12_000,
      toolCallCount: 3,
      isSettledTurn: true,
      bypassGate: true,
      currentSummary: null,
    });

    expect(result).toMatchObject({
      status: "started",
      runId: "summary-run-2",
      promotion: {
        created: 1,
        updated: 0,
        candidateIds: ["candidate-1"],
      },
    });
  });

  it("replays the latest queued turn after an in-flight summary run completes", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-session-summary-queue-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;

    let releaseFirstRun: (() => void) | undefined;
    const firstRun = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    const seenRecentMessages: string[] = [];
    const runtimeStore = {
      getSessionSummaryState: vi.fn().mockResolvedValue(null),
      upsertSessionSummaryState: vi.fn().mockResolvedValue(undefined),
    };
    const runner = vi
      .fn()
      .mockImplementation(async (params: { recentMessages: Array<{ content?: unknown }> }) => {
        const firstContent = params.recentMessages[0]?.content;
        seenRecentMessages.push(
          typeof firstContent === "string" ? firstContent : JSON.stringify(firstContent ?? ""),
        );
        if (seenRecentMessages.length === 1) {
          await firstRun;
        }
        return {
          status: "no_change",
          writtenCount: 0,
          updatedCount: 0,
          runId: `summary-run-${seenRecentMessages.length}`,
        };
      });
    const scheduler = new SessionSummaryScheduler({
      config: {
        enabled: true,
        initialTokenThreshold: 1,
        updateTokenThreshold: 1,
        minToolCalls: 0,
      },
      runtimeStore: runtimeStore as never,
      runner,
      logger: console,
    });

    scheduler.submitTurn({
      sessionId: "session-queue-1",
      sessionKey: "agent:main:main",
      sessionFile: "/tmp/session-queue-1.jsonl",
      workspaceDir: "/tmp/workspace",
      agentId: "main",
      recentMessages: [{ role: "assistant", content: "first" }] as never,
      lastModelVisibleMessageId: "msg-1",
      recentMessageLimit: 8,
      currentTokenCount: 12_000,
      toolCallCount: 3,
      isSettledTurn: true,
      currentSummary: null,
    });
    scheduler.submitTurn({
      sessionId: "session-queue-1",
      sessionKey: "agent:main:main",
      sessionFile: "/tmp/session-queue-1.jsonl",
      workspaceDir: "/tmp/workspace",
      agentId: "main",
      recentMessages: [{ role: "assistant", content: "second" }] as never,
      lastModelVisibleMessageId: "msg-2",
      recentMessageLimit: 8,
      currentTokenCount: 13_000,
      toolCallCount: 3,
      isSettledTurn: true,
      currentSummary: null,
    });

    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(1);
    });
    releaseFirstRun?.();
    await vi.waitFor(() => {
      expect(runner).toHaveBeenCalledTimes(2);
    });
    expect(seenRecentMessages).toEqual(["first", "second"]);
  });
});
