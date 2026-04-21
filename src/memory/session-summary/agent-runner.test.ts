import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpecialAgentCacheEnvelope } from "../../agents/special/runtime/parent-fork-context.js";
import {
  __testing,
  buildSessionSummaryTaskPrompt,
  parseSessionSummaryResult,
  SESSION_SUMMARY_AGENT_DEFINITION,
  runSessionSummaryAgentOnce,
} from "./agent-runner.js";

function createParentForkContext(params?: {
  parentRunId?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string;
  systemPromptText?: string;
  messages?: unknown[];
  thinkingConfig?: Record<string, unknown>;
}) {
  const messages = params?.messages ?? [{ role: "assistant", content: "Current state changed." }];
  return {
    parentRunId: params?.parentRunId ?? "parent-run-summary-1",
    provider: params?.provider ?? "openai",
    modelId: params?.modelId ?? "gpt-5.4",
    ...(params?.modelApi ? { modelApi: params.modelApi } : {}),
    promptEnvelope: buildSpecialAgentCacheEnvelope({
      systemPromptText: params?.systemPromptText ?? "parent system prompt",
      queryContextHash: "parent-query-context",
      toolNames: ["read", "session_summary_file_edit"],
      toolPromptPayload: [{ name: "read" }, { name: "session_summary_file_edit" }],
      thinkingConfig: params?.thinkingConfig ?? {},
      forkContextMessages: messages,
    }),
  };
}

describe("session summary agent runner", () => {
  const previousRoot = process.env.CRAWCLAW_SESSION_SUMMARY_DIR;
  const previousStateRoot = process.env.CRAWCLAW_STATE_DIR;

  beforeEach(() => {
    __testing.resetDepsForTest();
  });

  afterEach(() => {
    __testing.resetDepsForTest();
    if (previousRoot === undefined) {
      delete process.env.CRAWCLAW_SESSION_SUMMARY_DIR;
    } else {
      process.env.CRAWCLAW_SESSION_SUMMARY_DIR = previousRoot;
    }
    if (previousStateRoot === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = previousStateRoot;
    }
  });

  it("runs session summary through the embedded fork substrate", () => {
    expect(SESSION_SUMMARY_AGENT_DEFINITION.executionMode).toBe("embedded_fork");
    expect(SESSION_SUMMARY_AGENT_DEFINITION.toolPolicy).toMatchObject({
      allowlist: ["session_summary_file_read", "session_summary_file_edit"],
      enforcement: "runtime_deny",
    });
    expect(SESSION_SUMMARY_AGENT_DEFINITION.cachePolicy).toMatchObject({
      cacheRetention: "short",
    });
    expect(SESSION_SUMMARY_AGENT_DEFINITION.cachePolicy?.skipWrite).toBeUndefined();
  });

  it("builds a fork-context task prompt that keeps the edit set narrow", () => {
    const taskPrompt = buildSessionSummaryTaskPrompt({
      sessionId: "session-1",
      summaryPath: "/tmp/session-summary/agents/main/sessions/session-1/summary.md",
      currentSummary: null,
      profile: "light",
      maxSectionsToChange: 3,
    });

    expect(taskPrompt).toContain("Session ID: session-1");
    expect(taskPrompt).toContain("Summary profile: LIGHT");
    expect(taskPrompt).toContain("Max sections to change: 3");
    expect(taskPrompt).toContain("NOT part of the actual user conversation");
    expect(taskPrompt).toContain("<current_summary_content>");
    expect(taskPrompt).toContain("Based on the model-visible conversation above");
    expect(taskPrompt).toContain("provided as this forked agent's message history");
    expect(taskPrompt).not.toContain("Recent model-visible messages");
    expect(taskPrompt).toContain("session_summary_file_edit");
    expect(taskPrompt).toContain("Do not call any other tools");
    expect(taskPrompt).toContain("STRUCTURE PRESERVATION REMINDER");
    expect(taskPrompt).toContain("Open Loops");
    expect(taskPrompt).toContain("LIGHT profile runs");
  });

  it("does not embed recent-message excerpts in the task prompt", () => {
    const taskPrompt = buildSessionSummaryTaskPrompt({
      sessionId: "session-1",
      summaryPath: "/tmp/session-summary/agents/main/sessions/session-1/summary.md",
      currentSummary: null,
      profile: "full",
    });

    expect(taskPrompt).toContain("Based on the model-visible conversation above");
    expect(taskPrompt).not.toContain(
      "Recent model-visible messages since the last summary checkpoint",
    );
    expect(taskPrompt).not.toContain("This recent text should stay out of the task prompt.");
  });

  it("adds budget reminders when the current summary is oversized", () => {
    const taskPrompt = buildSessionSummaryTaskPrompt({
      sessionId: "session-oversized",
      summaryPath: "/tmp/session-summary/agents/main/sessions/session-oversized/summary.md",
      currentSummary: {
        sections: {
          currentState: ["x".repeat(9_000)],
          worklog: ["y".repeat(45_000)],
        },
      },
    });

    expect(taskPrompt).toContain("CRITICAL: The summary file is currently");
    expect(taskPrompt).toContain("You MUST condense it");
    expect(taskPrompt).toContain("exceed the per-section limit");
  });

  it("parses a structured agent report", () => {
    const result = parseSessionSummaryResult(`
STATUS: WRITTEN
SUMMARY: Updated the task section.
WRITTEN_COUNT: 1
UPDATED_COUNT: 2
`);
    expect(result).toEqual({
      status: "written",
      summary: "Updated the task section.",
      writtenCount: 1,
      updatedCount: 2,
    });
  });

  it("parses a markdown-formatted agent report", () => {
    const result = parseSessionSummaryResult(`
**STATUS: WRITTEN**
**SUMMARY:** Updated the task section.
WRITTEN_COUNT: 1
UPDATED_COUNT: 2
`);
    expect(result).toEqual({
      status: "written",
      summary: "Updated the task section.",
      writtenCount: 1,
      updatedCount: 2,
    });
  });

  it("records usage details on the final action for embedded session-summary runs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-session-summary-agent-"));
    process.env.CRAWCLAW_SESSION_SUMMARY_DIR = dir;
    process.env.CRAWCLAW_STATE_DIR = dir;
    const parentForkContext = createParentForkContext({
      parentRunId: "parent-run-usage-1",
      provider: "anthropic",
      modelId: "claude-sonnet",
      modelApi: "anthropic-messages",
      systemPromptText: "parent system prompt",
      messages: [{ role: "assistant", content: "Current state changed." }],
    });

    const emitAgentActionEvent = vi.fn();
    const runEmbeddedPiAgent = vi.fn().mockResolvedValue({
      payloads: [
        {
          text: [
            "STATUS: WRITTEN",
            "SUMMARY: Updated current state.",
            "WRITTEN_COUNT: 1",
            "UPDATED_COUNT: 2",
          ].join("\n"),
        },
      ],
      meta: {
        durationMs: 123,
        agentMeta: {
          sessionId: "session-1",
          provider: "anthropic",
          model: "claude-sonnet",
          usage: {
            input: 20,
            output: 8,
            cacheRead: 5,
            cacheWrite: 1,
            total: 34,
          },
        },
      },
    });
    __testing.setDepsForTest({
      emitAgentActionEvent,
      runEmbeddedPiAgent,
    });

    const result = await runSessionSummaryAgentOnce({
      sessionId: "session-1",
      sessionKey: "agent:main:session-1",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: dir,
      agentId: "main",
      parentForkContext,
    });

    expect(result).toMatchObject({
      status: "written",
      writtenCount: 1,
      updatedCount: 2,
    });
    const embeddedParams = runEmbeddedPiAgent.mock.calls[0]?.[0] as
      | { sessionId?: string; sessionFile?: string }
      | undefined;
    expect(embeddedParams?.sessionId).not.toBe("session-1");
    expect(embeddedParams?.sessionFile).not.toBe("/tmp/session-1.jsonl");
    expect(emitAgentActionEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "completed",
          projectedTitle: "Session summary updated",
          projectedSummary: "Updated current state.",
          detail: expect.objectContaining({
            memoryKind: "session_summary",
            memoryPhase: "final",
            memoryResultStatus: "written",
            usage: expect.objectContaining({
              input: 20,
              output: 8,
              cacheRead: 5,
              cacheWrite: 1,
              total: 34,
            }),
            historyMessageCount: 1,
          }),
        }),
      }),
    );
  });

  it("passes the parent prompt envelope with the full model-visible message context", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-session-summary-full-context-"));
    process.env.CRAWCLAW_SESSION_SUMMARY_DIR = dir;
    process.env.CRAWCLAW_STATE_DIR = dir;

    const fullModelVisibleMessages = [
      { role: "user", content: "full context user request" },
      { role: "assistant", content: "full context assistant response" },
    ] as never[];
    const parentForkContext = createParentForkContext({
      parentRunId: "parent-run-summary-1",
      modelApi: "openai-responses",
      messages: fullModelVisibleMessages,
      thinkingConfig: { thinkLevel: "low" },
    });
    const runEmbeddedPiAgent = vi.fn().mockResolvedValue({
      payloads: [
        {
          text: [
            "STATUS: NO_CHANGE",
            "SUMMARY: Already current.",
            "WRITTEN_COUNT: 0",
            "UPDATED_COUNT: 0",
          ].join("\n"),
        },
      ],
      meta: {
        durationMs: 1,
        agentMeta: { usage: { input: 1, output: 1, total: 2 } },
      },
    });
    __testing.setDepsForTest({
      emitAgentActionEvent: vi.fn(),
      runEmbeddedPiAgent,
    });

    await runSessionSummaryAgentOnce({
      sessionId: "session-1",
      sessionKey: "agent:main:session-1",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: dir,
      agentId: "main",
      parentForkContext,
    });

    const embeddedParams = runEmbeddedPiAgent.mock.calls[0]?.[0] as
      | {
          prompt?: string;
          extraSystemPrompt?: string;
          streamParams?: Record<string, unknown>;
          specialParentPromptEnvelope?: {
            systemPromptText?: string;
            forkContextMessages?: unknown[];
          };
        }
      | undefined;
    expect(embeddedParams?.specialParentPromptEnvelope).toMatchObject({
      systemPromptText: "parent system prompt",
      forkContextMessages: fullModelVisibleMessages,
    });
    expect(embeddedParams?.prompt).toContain("Based on the model-visible conversation above");
    expect(embeddedParams?.extraSystemPrompt).toBeUndefined();
    expect(embeddedParams?.streamParams).toEqual({ cacheRetention: "short" });
  });

  it("fails without falling back to recent excerpts when the parent fork context is unavailable", async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "crawclaw-session-summary-missing-fork-context-"),
    );
    process.env.CRAWCLAW_SESSION_SUMMARY_DIR = dir;
    process.env.CRAWCLAW_STATE_DIR = dir;

    const runEmbeddedPiAgent = vi.fn().mockResolvedValue({
      payloads: [
        {
          text: [
            "STATUS: NO_CHANGE",
            "SUMMARY: Already current.",
            "WRITTEN_COUNT: 0",
            "UPDATED_COUNT: 0",
          ].join("\n"),
        },
      ],
      meta: {
        durationMs: 1,
        agentMeta: { usage: { input: 1, output: 1, total: 2 } },
      },
    });
    __testing.setDepsForTest({
      emitAgentActionEvent: vi.fn(),
      runEmbeddedPiAgent,
    });

    const result = await runSessionSummaryAgentOnce({
      sessionId: "session-1",
      sessionKey: "agent:main:session-1",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: dir,
      agentId: "main",
    });

    expect(result).toMatchObject({
      status: "failed",
      reason: "session summary requires a parent fork context",
    });
    expect(runEmbeddedPiAgent).not.toHaveBeenCalled();
  });
});
