import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSummaryScheduler, evaluateSessionSummaryGate } from "./scheduler.js";

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
      currentTokenCount: 9_999,
      summaryText: "",
    });
    expect(gate.ready).toBe(false);
    expect(gate.reason).toBe("below_initial_token_threshold");
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
});
