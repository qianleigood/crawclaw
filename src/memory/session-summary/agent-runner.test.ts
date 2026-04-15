import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  buildSessionSummarySystemPrompt,
  buildSessionSummaryTaskPrompt,
  parseSessionSummaryResult,
  SESSION_SUMMARY_AGENT_DEFINITION,
  runSessionSummaryAgentOnce,
} from "./agent-runner.js";

describe("session summary agent runner", () => {
  const previousRoot = process.env.CRAWCLAW_SESSION_SUMMARY_DIR;

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
  });

  it("renders a Claude-style single-file maintenance prompt", () => {
    const systemPrompt = buildSessionSummarySystemPrompt();
    expect(systemPrompt).toContain("dedicated background session summary agent");
    expect(systemPrompt).toContain("summary.md");
    expect(systemPrompt).toContain("italic section description lines");
    expect(systemPrompt).toContain("make all edit calls in parallel in a single message");
    expect(systemPrompt).toContain("Current State");
    expect(systemPrompt).toContain("Always update Current State");
    expect(systemPrompt).toContain("Fixed Section Spec");
    expect(systemPrompt).toContain("Codebase and System Documentation");
  });

  it("runs session summary through the embedded fork substrate", () => {
    expect(SESSION_SUMMARY_AGENT_DEFINITION.executionMode).toBe("embedded_fork");
    expect(SESSION_SUMMARY_AGENT_DEFINITION.toolPolicy).toMatchObject({
      allowlist: ["session_summary_file_read", "session_summary_file_edit"],
      enforcement: "runtime_deny",
    });
    expect(SESSION_SUMMARY_AGENT_DEFINITION.cachePolicy).toMatchObject({
      cacheRetention: "short",
      skipWrite: true,
      promptCache: {
        scope: "parent_session",
        retention: "24h",
      },
    });
  });

  it("builds a task prompt that keeps the edit set narrow", () => {
    const taskPrompt = buildSessionSummaryTaskPrompt({
      sessionId: "session-1",
      summaryPath: "/tmp/session-summary/agents/main/sessions/session-1/summary.md",
      currentSummary: null,
      recentMessages: [
        { role: "user", content: "Please summarize the current memory architecture." },
        { role: "assistant", content: "I will update the session summary." },
      ] as never[],
      recentMessageLimit: 8,
      maxSectionsToChange: 3,
    });

    expect(taskPrompt).toContain("Session ID: session-1");
    expect(taskPrompt).toContain("Max sections to change: 3");
    expect(taskPrompt).toContain("NOT part of the actual user conversation");
    expect(taskPrompt).toContain("<current_summary_content>");
    expect(taskPrompt).toContain("Recent model-visible messages");
    expect(taskPrompt).toContain("session_summary_file_edit");
    expect(taskPrompt).toContain("Do not call any other tools");
    expect(taskPrompt).toContain("STRUCTURE PRESERVATION REMINDER");
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
      recentMessages: [
        { role: "assistant", content: "Large summary needs condensing." },
      ] as never[],
      recentMessageLimit: 4,
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
      recentMessages: [{ role: "assistant", content: "Current state changed." }] as never[],
      recentMessageLimit: 8,
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
          detail: expect.objectContaining({
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
});
