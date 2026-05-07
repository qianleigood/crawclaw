import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/config.js";
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
    clearRuntimeConfigSnapshot();
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
    expect(DREAM_AGENT_DEFINITION.transcriptPolicy).toBe("isolated");
    expect(DREAM_AGENT_DEFINITION.parentContextPolicy).toBe("none");
    expect(DREAM_AGENT_DEFINITION.toolPolicy).toMatchObject({
      allowlist: [
        "read",
        "exec",
        "write",
        "edit",
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
      ],
      enforcement: "runtime_deny",
      modelVisibility: "allowlist",
      guard: "memory_maintenance",
    });
    expect(DREAM_AGENT_DEFINITION.cachePolicy).toMatchObject({
      cacheRetention: "short",
      skipWrite: true,
    });
    const systemPrompt = buildDreamSystemPrompt();
    expect(DREAM_AGENT_DEFINITION.defaultMaxTurns).toBeUndefined();
    expect(systemPrompt).not.toContain("hard turn budget");
    expect(systemPrompt).toContain("Complete within the run timeout");
    expect(systemPrompt).toContain("Review the provided existing durable memory manifest");
    expect(systemPrompt).toContain("session transcript references");
    expect(systemPrompt).toContain("read-only exec");
    expect(systemPrompt).toContain("host guard blocks non-read-only exec");
    expect(systemPrompt).toContain("You do not inherit the parent agent prompt");
    expect(systemPrompt).toContain(
      "host-provided manifest, structured signals, and transcript refs",
    );
    expect(systemPrompt).toContain("Use transcript refs like Claude Code auto-dream");
    expect(systemPrompt).toContain(
      "Do not create or rewrite durable memory solely from transcript search",
    );
    expect(systemPrompt).toContain(
      "Do NOT create or rewrite durable notes for reusable procedures, command sequences, debugging workflows, test strategies, failure patterns, or implementation lessons",
    );
    expect(systemPrompt).toContain("Those belong to experience memory");
    expect(systemPrompt).not.toContain("Transcript fallback");
    expect(systemPrompt).toContain("Keep MEMORY.md as a short index");
    expect(systemPrompt).toContain("Orient -> Gather -> Consolidate -> Prune");
    expect(systemPrompt).toContain("description");
    expect(systemPrompt).toContain("dedupeKey");
    expect(systemPrompt).toContain("index hook");

    const taskPrompt = buildDreamTaskPrompt({
      scopeKey: "main",
      triggerSource: "stop",
      lastSuccessAt: null,
      recentTranscriptRefs: [{ sessionId: "s1", path: "/tmp/s1.jsonl" }],
      recentSignals: [
        {
          sessionId: "s1",
          kind: "archive_actions",
          text: "Durable memory agent wrote durable notes",
        },
      ],
      existingEntries: [],
      dryRun: true,
    });
    expect(taskPrompt).toContain("Mode: dry-run preview");
    expect(taskPrompt).not.toContain("Recent session summaries");
    expect(taskPrompt).not.toContain("source=session_summary");
    expect(taskPrompt).not.toContain("<session_summary>");
    expect(taskPrompt).toContain("Existing durable memory manifest:");
    expect(taskPrompt).toContain("Recent structured signals:");
    expect(taskPrompt).toContain("<signal>");
    expect(taskPrompt).toContain("</signal>");
    expect(taskPrompt).toContain(
      "Session transcripts available for optional narrow read/read-only-exec lookup",
    );
    expect(taskPrompt).toContain("session=s1 | path=/tmp/s1.jsonl");
    expect(taskPrompt).toContain("Transcript lookup rules:");
    expect(taskPrompt).toContain("Do not read whole JSONL transcript files");
    expect(taskPrompt).toContain("Gather recent signal from structured signals first");
    expect(taskPrompt).not.toContain("lastTurn=");
    expect(taskPrompt).not.toContain("Transcript fallback:");
    expect(taskPrompt).toContain("Prune and index");
    expect(taskPrompt).toContain("do not call any write/edit/delete tool");
  });

  it("runs dream as an independent embedded maintenance agent and emits action events", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-dream-"));
    process.env.CRAWCLAW_DURABLE_MEMORY_DIR = dir;
    setRuntimeConfigSnapshot({
      agents: {
        defaults: {
          model: "openai/gpt-5.4",
        },
      },
    });
    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    expect(scope).not.toBeNull();

    const emitAgentActionEvent = vi.fn();
    const spawnAgentSessionDirect = vi.fn();
    const callGateway = vi.fn();
    const captureSubagentCompletionReply = vi.fn();
    const onAgentEvent = vi.fn(() => () => {});
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
          sessionId: "embedded-dream-session",
          provider: "openai",
          model: "gpt-5.4",
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
      spawnAgentSessionDirect,
      callGateway,
      captureSubagentCompletionReply,
      onAgentEvent,
      runEmbeddedPiAgent,
    });

    const result = await runDreamAgentOnce({
      runId: "mrun-1",
      sessionId: "session-1",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: dir,
      scope: scope!,
      sessionKey: "agent:main:feishu:user-1",
      triggerSource: "stop",
      lastSuccessAt: null,
      recentTranscriptRefs: [{ sessionId: "s1", path: "/tmp/s1.jsonl" }],
      recentSignals: [
        {
          sessionId: "s1",
          kind: "archive_actions",
          text: "Durable memory agent wrote durable notes",
        },
      ],
    });

    expect(result).toMatchObject({
      status: "written",
      writtenCount: 1,
      updatedCount: 1,
    });
    expect(spawnAgentSessionDirect).not.toHaveBeenCalled();
    expect(callGateway).not.toHaveBeenCalled();
    expect(captureSubagentCompletionReply).not.toHaveBeenCalled();
    expect(onAgentEvent).not.toHaveBeenCalled();
    expect(runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        specialAgentSpawnSource: "dream",
        sessionId: expect.stringMatching(/^embedded-dream-special-dream-/),
        sessionKey: expect.stringMatching(/^embedded:dream:special:dream:/),
        sessionFile: expect.stringMatching(/embedded-dream-special-dream-.*\.jsonl$/),
        workspaceDir: dir,
        prompt: expect.stringContaining("Consolidate durable memory for the current scope"),
        extraSystemPrompt: expect.stringContaining("# Dream Agent"),
        provider: "openai",
        model: "gpt-5.4",
        toolsAllow: [
          "read",
          "exec",
          "write",
          "edit",
          "memory_manifest_read",
          "memory_note_read",
          "memory_note_write",
          "memory_note_edit",
          "memory_note_delete",
        ],
        specialDurableMemoryScope: {
          agentId: "main",
          channel: "feishu",
          userId: "user-1",
        },
      }),
    );
    const embeddedParams = runEmbeddedPiAgent.mock.calls[0]?.[0] as
      | {
          maxTurns?: number;
          agentId?: string;
          sessionId?: string;
          sessionFile?: string;
          surfacedSkillNames?: string[];
          specialParentPromptEnvelope?: unknown;
        }
      | undefined;
    expect(embeddedParams?.maxTurns).toBeUndefined();
    expect(embeddedParams?.agentId).toBeUndefined();
    expect(embeddedParams?.sessionId).not.toBe("session-1");
    expect(embeddedParams?.sessionFile).not.toBe("/tmp/session-1.jsonl");
    expect(embeddedParams?.surfacedSkillNames).toBeUndefined();
    expect(embeddedParams?.specialParentPromptEnvelope).toBeUndefined();
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
