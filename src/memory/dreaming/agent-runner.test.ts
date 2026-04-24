import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpecialAgentCacheEnvelope } from "../../agents/special/runtime/parent-fork-context.js";
import { resolveDurableMemoryScope } from "../durable/scope.js";
import {
  __testing,
  DREAM_AGENT_DEFINITION,
  buildDreamSystemPrompt,
  buildDreamTaskPrompt,
  parseDreamResult,
  runDreamAgentOnce,
} from "./agent-runner.js";

describe("runDreamAgentOnce", () => {
  const previousRoot = process.env.CRAWCLAW_DURABLE_MEMORY_DIR;

  beforeEach(() => {
    __testing.setDepsForTest();
  });

  afterEach(() => {
    __testing.setDepsForTest();
    if (previousRoot === undefined) {
      delete process.env.CRAWCLAW_DURABLE_MEMORY_DIR;
    } else {
      process.env.CRAWCLAW_DURABLE_MEMORY_DIR = previousRoot;
    }
  });

  it("parses strict dream reports", () => {
    expect(
      parseDreamResult(
        [
          "STATUS: WRITTEN",
          "SUMMARY: merged duplicate notes",
          "WRITTEN_COUNT: 1",
          "UPDATED_COUNT: 2",
          "DELETED_COUNT: 1",
        ].join("\n"),
      ),
    ).toEqual({
      status: "written",
      summary: "merged duplicate notes",
      writtenCount: 1,
      updatedCount: 2,
      deletedCount: 1,
    });
  });

  it("parses markdown-formatted dream reports", () => {
    expect(
      parseDreamResult(
        [
          "**STATUS: NO_CHANGE**",
          "",
          "**SUMMARY:** nothing durable changed",
          "",
          "WRITTEN_COUNT: 0",
          "UPDATED_COUNT: 0",
          "DELETED_COUNT: 0",
          "**TOUCHED_NOTES:** notes/a.md | notes/b.md",
        ].join("\n"),
      ),
    ).toEqual({
      status: "no_change",
      summary: "nothing durable changed",
      writtenCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      touchedNotes: ["notes/a.md", "notes/b.md"],
    });
  });

  it("aligns the dream prompt with the orient/gather/consolidate/prune workflow", () => {
    expect(DREAM_AGENT_DEFINITION.executionMode).toBe("embedded_fork");
    expect(DREAM_AGENT_DEFINITION.toolPolicy).toMatchObject({
      allowlist: [
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
        "memory_transcript_search",
      ],
      enforcement: "runtime_deny",
    });
    expect(DREAM_AGENT_DEFINITION.cachePolicy).toMatchObject({
      cacheRetention: "short",
      skipWrite: true,
    });
    const systemPrompt = buildDreamSystemPrompt();
    expect(systemPrompt).toContain("hard turn budget of 8 turns");
    expect(systemPrompt).toContain("Review the provided recent session summaries");
    expect(systemPrompt).toContain("Do not grep transcripts as a primary workflow");
    expect(systemPrompt).toContain("memory_transcript_search");
    expect(systemPrompt).toContain("fallback only");
    expect(systemPrompt).toContain("Keep MEMORY.md as a short index");
    expect(systemPrompt).toContain("Orient -> Gather -> Consolidate -> Prune");
    expect(systemPrompt).toContain("description");
    expect(systemPrompt).toContain("dedupeKey");
    expect(systemPrompt).toContain("index hook");

    const taskPrompt = buildDreamTaskPrompt({
      scopeKey: "main:feishu:user-1",
      triggerSource: "stop",
      lastSuccessAt: null,
      recentSessions: [
        {
          sessionId: "s1",
          summaryText:
            "The user confirmed step-first answers and a release freeze through April 30.",
          lastSummarizedTurn: 12,
          updatedAt: Date.now(),
        },
      ],
      recentSignals: [
        {
          sessionId: "s1",
          kind: "archive_actions",
          text: "Memory extraction wrote durable notes",
        },
      ],
      transcriptFallback: {
        enabled: true,
        reasons: ["missing_session_summary"],
        sessionIds: ["s1"],
        limits: {
          maxSessions: 4,
          maxMatchesPerSession: 2,
          maxTotalBytes: 12_000,
          maxExcerptChars: 900,
        },
      },
      existingEntries: [],
      dryRun: true,
    });
    expect(taskPrompt).toContain("Mode: dry-run preview");
    expect(taskPrompt).toContain("Recent session summaries since the last successful dream run");
    expect(taskPrompt).toContain("Recent structured signals:");
    expect(taskPrompt).toContain("Gather recent signal from the provided session summaries first");
    expect(taskPrompt).toContain("Transcript fallback:");
    expect(taskPrompt).toContain("missing_session_summary");
    expect(taskPrompt).toContain("memory_transcript_search");
    expect(taskPrompt).toContain("sessionIds=s1");
    expect(taskPrompt).toContain("Prune and index");
    expect(taskPrompt).toContain("do not call any write/edit/delete tool");
  });

  it("spawns a background dream agent and emits action events", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-dream-"));
    process.env.CRAWCLAW_DURABLE_MEMORY_DIR = dir;
    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    expect(scope).not.toBeNull();

    const emitAgentActionEvent = vi.fn();
    const runEmbeddedPiAgent = vi.fn().mockResolvedValue({
      payloads: [
        {
          text: [
            "STATUS: WRITTEN",
            "SUMMARY: merged duplicate feedback notes",
            "WRITTEN_COUNT: 1",
            "UPDATED_COUNT: 1",
            "DELETED_COUNT: 0",
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
            input: 18,
            output: 9,
            cacheRead: 7,
            cacheWrite: 2,
            total: 36,
          },
        },
      },
    });
    __testing.setDepsForTest({
      emitAgentActionEvent,
      runEmbeddedPiAgent,
    });
    const parentForkContext = {
      parentRunId: "parent-run-dream-1",
      provider: "openai",
      modelId: "gpt-5.4",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "Parent system prompt",
        forkContextMessages: [{ role: "user", content: "remember step-first answers" }],
      }),
    };

    const result = await runDreamAgentOnce({
      runId: "mrun-1",
      sessionId: "session-1",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: dir,
      parentForkContext,
      scope: scope!,
      sessionKey: "agent:main:feishu:user-1",
      triggerSource: "stop",
      lastSuccessAt: null,
      recentSessions: [
        {
          sessionId: "s1",
          summaryText:
            "The user confirmed step-first answers and a release freeze through April 30.",
          lastSummarizedTurn: 12,
          updatedAt: Date.now(),
        },
      ],
      recentSignals: [
        {
          sessionId: "s1",
          kind: "archive_actions",
          text: "Memory extraction wrote durable notes",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "written",
      writtenCount: 1,
      updatedCount: 1,
    });
    expect(runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        specialAgentSpawnSource: "dream",
        provider: "openai",
        model: "gpt-5.4",
        maxTurns: 8,
        specialDurableMemoryScope: {
          agentId: "main",
          channel: "feishu",
          userId: "user-1",
        },
        workspaceDir: dir,
      }),
    );
    const embeddedParams = runEmbeddedPiAgent.mock.calls[0]?.[0] as
      | { sessionId?: string; sessionFile?: string }
      | undefined;
    expect(embeddedParams?.sessionId).not.toBe("session-1");
    expect(embeddedParams?.sessionFile).not.toBe("/tmp/session-1.jsonl");
    expect(runEmbeddedPiAgent.mock.calls[0]?.[0]).not.toHaveProperty("specialParentPromptEnvelope");
    expect(emitAgentActionEvent).toHaveBeenCalledTimes(4);
    expect(emitAgentActionEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "completed",
          projectedTitle: "Dream updated durable notes",
          projectedSummary: "merged duplicate feedback notes",
          detail: expect.objectContaining({
            memoryKind: "dream",
            memoryPhase: "final",
            memoryResultStatus: "written",
            usage: expect.objectContaining({
              input: 18,
              output: 9,
              cacheRead: 7,
              cacheWrite: 2,
              total: 36,
            }),
            historyMessageCount: 1,
          }),
        }),
      }),
    );
  });
});
