import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSpecialAgentCacheEnvelope } from "../../agents/special/runtime/parent-fork-context.js";
import { SessionSummaryScheduler, evaluateSessionSummaryGate } from "./scheduler.js";

function createParentForkContext(params?: {
  parentRunId?: string;
  messages?: Array<{ role: string; content: string }>;
}) {
  const messages = params?.messages ?? [{ role: "assistant", content: "summarize this" }];
  return {
    parentRunId: params?.parentRunId ?? "parent-run-1",
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
}

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

  it("threads the parent fork context into the session summary runner", async () => {
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

    const parentForkContext = createParentForkContext();
    const result = await scheduler.runNow({
      sessionId: "session-1",
      sessionKey: "agent:main:main",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: "/tmp/workspace",
      agentId: "main",
      recentMessages: [{ role: "assistant", content: "summarize this" }] as never,
      parentForkContext,
      lastModelVisibleMessageId: "msg-1",
      recentMessageLimit: 8,
      currentTokenCount: 12_000,
      toolCallCount: 3,
      isSettledTurn: true,
      bypassGate: true,
      currentSummary: null,
    });

    expect(result).toMatchObject({ status: "no_change", runId: "summary-run-1" });
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        sessionFile: "/tmp/session-1.jsonl",
        workspaceDir: "/tmp/workspace",
        parentForkContext,
      }),
      console,
    );
  });

  it("skips ready runs when fork context is missing", async () => {
    const stateDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-session-summary-missing-fork-"),
    );
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const runtimeStore = {
      getSessionSummaryState: vi.fn().mockResolvedValue(null),
      upsertSessionSummaryState: vi.fn().mockResolvedValue(undefined),
    };
    const runner = vi.fn();
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
      sessionId: "session-missing-fork",
      sessionKey: "agent:main:main",
      sessionFile: "/tmp/session-missing-fork.jsonl",
      workspaceDir: "/tmp/workspace",
      agentId: "main",
      recentMessages: [{ role: "assistant", content: "summarize this" }] as never,
      recentMessageLimit: 8,
      currentTokenCount: 12_000,
      toolCallCount: 3,
      isSettledTurn: true,
      bypassGate: true,
      currentSummary: null,
    });

    expect(result).toMatchObject({ status: "skipped", reason: "missing_fork_context" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("uses per-turn model-aware thresholds for the preview gate", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-session-summary-policy-"));
    tempDirs.push(stateDir);
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    const runtimeStore = {
      getSessionSummaryState: vi.fn().mockResolvedValue(null),
      upsertSessionSummaryState: vi.fn().mockResolvedValue(undefined),
    };
    const scheduler = new SessionSummaryScheduler({
      config: {
        enabled: true,
        lightInitialTokenThreshold: 3_000,
        initialTokenThreshold: 10_000,
        updateTokenThreshold: 5_000,
        minToolCalls: 0,
      },
      runtimeStore: runtimeStore as never,
      runner: vi.fn(),
      logger: console,
    });

    const preview = await scheduler.preview({
      sessionId: "session-policy-1",
      sessionKey: "agent:main:main",
      sessionFile: "/tmp/session-policy-1.jsonl",
      workspaceDir: "/tmp/workspace",
      agentId: "main",
      recentMessages: [{ role: "assistant", content: "not enough yet" }] as never,
      parentForkContext: createParentForkContext(),
      currentTokenCount: 20_000,
      toolCallCount: 0,
      isSettledTurn: true,
      currentSummary: null,
      lightInitialTokenThreshold: 24_000,
      initialTokenThreshold: 80_000,
      updateTokenThreshold: 40_000,
    });

    expect(preview.targetProfile).toBe("light");
    expect(preview.gate).toMatchObject({
      ready: false,
      reason: "below_initial_token_threshold",
      currentTokenCount: 20_000,
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
    const seenModelVisibleMessages: string[] = [];
    const runtimeStore = {
      getSessionSummaryState: vi.fn().mockResolvedValue(null),
      upsertSessionSummaryState: vi.fn().mockResolvedValue(undefined),
    };
    const runner = vi.fn().mockImplementation(
      async (params: {
        parentForkContext: {
          promptEnvelope: { forkContextMessages: Array<{ content?: unknown }> };
        };
      }) => {
        const firstContent =
          params.parentForkContext.promptEnvelope.forkContextMessages[0]?.content;
        seenModelVisibleMessages.push(
          typeof firstContent === "string" ? firstContent : JSON.stringify(firstContent ?? ""),
        );
        if (seenModelVisibleMessages.length === 1) {
          await firstRun;
        }
        return {
          status: "no_change",
          writtenCount: 0,
          updatedCount: 0,
          runId: `summary-run-${seenModelVisibleMessages.length}`,
        };
      },
    );
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
      parentForkContext: createParentForkContext({
        parentRunId: "parent-run-1",
        messages: [{ role: "assistant", content: "first" }],
      }),
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
      parentForkContext: createParentForkContext({
        parentRunId: "parent-run-2",
        messages: [{ role: "assistant", content: "second" }],
      }),
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
    expect(seenModelVisibleMessages).toEqual(["first", "second"]);
  });
});
