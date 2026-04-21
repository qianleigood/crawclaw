import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpecialAgentCacheEnvelope } from "../../agents/special/runtime/parent-fork-context.js";
import { makeAgentUserMessage } from "../../agents/test-helpers/agent-message-fixtures.js";
import {
  __testing,
  MEMORY_EXTRACTION_AGENT_DEFINITION,
  buildMemoryExtractionSystemPrompt,
  buildMemoryExtractionTaskPrompt,
  parseMemoryExtractorResult,
  runDurableExtractionAgentOnce,
} from "./agent-runner.js";
import { resolveDurableMemoryScope } from "./scope.js";

describe("runDurableExtractionAgentOnce", () => {
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

  it("parses strict memory extractor reports", () => {
    expect(
      parseMemoryExtractorResult(
        [
          "STATUS: WRITTEN",
          "SUMMARY: saved one durable note",
          "WRITTEN_COUNT: 1",
          "UPDATED_COUNT: 0",
          "DELETED_COUNT: 0",
        ].join("\n"),
      ),
    ).toEqual({
      status: "written",
      summary: "saved one durable note",
      writtenCount: 1,
      updatedCount: 0,
      deletedCount: 0,
    });
  });

  it("parses markdown-formatted memory extractor reports", () => {
    expect(
      parseMemoryExtractorResult(
        [
          "**STATUS: NO_CHANGE**",
          "",
          "**SUMMARY:** no durable note needed",
          "",
          "WRITTEN_COUNT: 0",
          "UPDATED_COUNT: 0",
          "DELETED_COUNT: 0",
        ].join("\n"),
      ),
    ).toEqual({
      status: "no_change",
      summary: "no durable note needed",
      writtenCount: 0,
      updatedCount: 0,
      deletedCount: 0,
    });
  });

  it("aligns the memory extractor prompt with the turn-budget workflow", () => {
    expect(MEMORY_EXTRACTION_AGENT_DEFINITION.executionMode).toBe("embedded_fork");
    expect(MEMORY_EXTRACTION_AGENT_DEFINITION.toolPolicy).toMatchObject({
      allowlist: [
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
      ],
      enforcement: "runtime_deny",
    });
    expect(MEMORY_EXTRACTION_AGENT_DEFINITION.cachePolicy).toMatchObject({
      cacheRetention: "short",
      skipWrite: true,
    });
    const systemPrompt = buildMemoryExtractionSystemPrompt();
    expect(systemPrompt).toContain("hard turn budget of 5 turns");
    expect(systemPrompt).toContain("Use the provided manifest first");
    expect(systemPrompt).toContain(
      "Do NOT bounce between investigation and writing across many turns",
    );
    expect(systemPrompt).toContain(
      "Do not attempt to verify them against code, git state, or external systems",
    );
    expect(systemPrompt).toContain("memory_manifest_read");
    expect(systemPrompt).toContain("memory_note_read");
    expect(systemPrompt).toContain("memory_note_write");
    expect(systemPrompt).toContain("memory_note_edit");
    expect(systemPrompt).toContain("memory_note_delete");

    const taskPrompt = buildMemoryExtractionTaskPrompt({
      scopeKey: "main:feishu:user-1",
      recentMessages: [makeAgentUserMessage({ content: "以后操作类回答先给步骤。" })],
      recentMessageLimit: 24,
      existingEntries: [],
      maxNotes: 2,
    });
    expect(taskPrompt).toContain("Existing durable memory manifest:");
    expect(taskPrompt).toContain("First review the manifest");
    expect(taskPrompt).toContain(
      "Only create a new note when no existing note can be updated cleanly",
    );
    expect(taskPrompt).toContain("Use memory_note_read before memory_note_edit");
    expect(taskPrompt).toContain("Update MEMORY.md whenever the note set changes");
  });

  it("spawns a background memory extractor agent and emits action events", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-memory-extractor-agent-"));
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
            "SUMMARY: saved one durable note",
            "WRITTEN_COUNT: 1",
            "UPDATED_COUNT: 0",
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
            input: 12,
            output: 6,
            cacheRead: 4,
            cacheWrite: 1,
            total: 23,
          },
        },
      },
    });
    __testing.setDepsForTest({
      emitAgentActionEvent,
      runEmbeddedPiAgent,
    });
    const fullForkMessages = [
      makeAgentUserMessage({ content: "旧上下文：我只想要中文回答。" }),
      makeAgentUserMessage({ content: "以后操作类回答先给步骤。" }),
    ];
    const parentForkContext = {
      parentRunId: "parent-run-1",
      provider: "openai",
      modelId: "gpt-5.4",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "parent system prompt",
        toolNames: ["read"],
        toolPromptPayload: [{ name: "read" }],
        thinkingConfig: {},
        forkContextMessages: fullForkMessages,
      }),
    };

    const result = await runDurableExtractionAgentOnce({
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:user-1",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: dir,
      scope: scope!,
      parentForkContext,
      messageCursor: 2,
      recentMessages: [makeAgentUserMessage({ content: "以后操作类回答先给步骤。" })],
      recentMessageLimit: 24,
      maxNotes: 2,
    });

    expect(result).toMatchObject({
      status: "written",
      notesSaved: 1,
      advanceCursor: true,
    });
    expect(runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        specialAgentSpawnSource: "memory-extraction",
        maxTurns: 5,
        specialDurableMemoryScope: {
          agentId: "main",
          channel: "feishu",
          userId: "user-1",
        },
        workspaceDir: dir,
      }),
    );
    expect(runEmbeddedPiAgent.mock.calls[0]?.[0]).not.toHaveProperty(
      "specialInheritedPromptEnvelope",
    );
    const embeddedParams = runEmbeddedPiAgent.mock.calls[0]?.[0] as
      | {
          sessionId?: string;
          sessionFile?: string;
          specialParentPromptEnvelope?: { forkContextMessages?: unknown[] };
        }
      | undefined;
    expect(embeddedParams?.specialParentPromptEnvelope).toMatchObject({
      systemPromptText: "parent system prompt",
      forkContextMessages: fullForkMessages,
    });
    expect(embeddedParams?.sessionId).not.toBe("session-1");
    expect(embeddedParams?.sessionFile).not.toBe("/tmp/session-1.jsonl");
    expect(emitAgentActionEvent).toHaveBeenCalledTimes(3);
    expect(emitAgentActionEvent.mock.calls[0]?.[0]).toMatchObject({
      data: expect.objectContaining({
        kind: "memory",
        status: "started",
        projectedTitle: "Memory extraction scheduled",
        projectedSummary: "main:feishu:user-1",
        detail: expect.objectContaining({
          memoryKind: "extraction",
          memoryPhase: "scheduled",
        }),
      }),
    });
    expect(emitAgentActionEvent.mock.calls[1]?.[0]).toMatchObject({
      data: expect.objectContaining({
        kind: "memory",
        status: "running",
        projectedTitle: "Memory extraction running",
        projectedSummary: "main:feishu:user-1",
        detail: expect.objectContaining({
          memoryKind: "extraction",
          memoryPhase: "running",
        }),
      }),
    });
    expect(emitAgentActionEvent.mock.calls[2]?.[0]).toMatchObject({
      data: expect.objectContaining({
        kind: "memory",
        status: "completed",
        title: "Memory extraction wrote durable notes",
        projectedTitle: "Memory extraction wrote durable notes",
        projectedSummary: "saved one durable note",
        detail: expect.objectContaining({
          memoryKind: "extraction",
          memoryPhase: "final",
          memoryResultStatus: "written",
          usage: expect.objectContaining({
            input: 12,
            output: 6,
            cacheRead: 4,
            cacheWrite: 1,
            total: 23,
          }),
          historyMessageCount: 1,
        }),
      }),
    });
  });

  it("fails closed when the background memory extractor cannot start", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-memory-extractor-agent-"));
    process.env.CRAWCLAW_DURABLE_MEMORY_DIR = dir;
    const scope = resolveDurableMemoryScope({
      agentId: "main",
      channel: "feishu",
      userId: "user-1",
    });
    expect(scope).not.toBeNull();

    const emitAgentActionEvent = vi.fn();
    __testing.setDepsForTest({
      emitAgentActionEvent,
      runEmbeddedPiAgent: vi.fn().mockRejectedValue(new Error("pairing required")),
    });

    const result = await runDurableExtractionAgentOnce({
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:user-1",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: dir,
      scope: scope!,
      messageCursor: 2,
      recentMessages: [makeAgentUserMessage({ content: "以后操作类回答先给步骤。" })],
      recentMessageLimit: 24,
      maxNotes: 2,
    });

    expect(result).toMatchObject({
      status: "failed",
      notesSaved: 0,
      advanceCursor: false,
    });
    expect(emitAgentActionEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "memory",
          status: "failed",
          title: "Memory extraction did not complete",
          projectedTitle: "Memory extraction did not complete",
          projectedSummary: "pairing required",
          detail: expect.objectContaining({
            memoryKind: "extraction",
            memoryPhase: "wait_failed",
          }),
        }),
      }),
    );
  });
});
