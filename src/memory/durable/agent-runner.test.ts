import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSpecialAgentCacheEnvelope } from "../../agents/special/runtime/parent-fork-context.js";
import { makeAgentUserMessage } from "../../agents/test-helpers/agent-message-fixtures.js";
import {
  __testing,
  DURABLE_MEMORY_AGENT_DEFINITION,
  buildDurableMemoryAgentTaskPrompt,
  parseDurableMemoryAgentResult,
  runDurableMemoryAgentOnce,
} from "./agent-runner.js";
import { resolveDurableMemoryScope } from "./scope.js";

describe("runDurableMemoryAgentOnce", () => {
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

  it("parses strict durable memory agent reports", () => {
    expect(
      parseDurableMemoryAgentResult(
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

  it("parses markdown-formatted durable memory agent reports", () => {
    expect(
      parseDurableMemoryAgentResult(
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

  it("aligns the durable memory agent prompt with the turn-budget workflow", () => {
    expect(DURABLE_MEMORY_AGENT_DEFINITION).toMatchObject({
      id: "durable_memory",
      label: "durable-memory",
      spawnSource: "durable-memory",
    });
    expect(DURABLE_MEMORY_AGENT_DEFINITION.executionMode).toBe("embedded_fork");
    expect(DURABLE_MEMORY_AGENT_DEFINITION.systemPromptMode).toBeUndefined();
    expect(DURABLE_MEMORY_AGENT_DEFINITION.toolPolicy).toMatchObject({
      allowlist: [
        "memory_manifest_read",
        "memory_note_read",
        "memory_note_write",
        "memory_note_edit",
        "memory_note_delete",
      ],
      enforcement: "runtime_deny",
      modelVisibility: "allowlist",
    });
    expect(DURABLE_MEMORY_AGENT_DEFINITION.cachePolicy).toMatchObject({
      cacheRetention: "short",
      skipWrite: true,
    });

    const taskPrompt = buildDurableMemoryAgentTaskPrompt({
      scopeKey: "main:feishu:user-1",
      newMessageCount: 2,
      existingEntries: [],
      maxNotes: 2,
    });
    expect(taskPrompt).toContain("You are now acting as the durable memory extraction subagent");
    expect(taskPrompt).toContain("Analyze the most recent ~2 model-visible messages above");
    expect(taskPrompt).not.toContain(
      "Recent model-visible messages since the last extraction cursor",
    );
    expect(taskPrompt).toContain("Existing durable memory manifest:");
    expect(taskPrompt).toContain(
      "Only use those recent model-visible messages to update durable memory",
    );
    expect(taskPrompt).toContain(
      "First classify each candidate as durable profile/context memory or experience memory",
    );
    expect(taskPrompt).toContain(
      "If the recent messages contain only operational experience, do not write durable memory",
    );
    expect(taskPrompt).toContain("First review the manifest");
    expect(taskPrompt).toContain(
      "Only create a new note when no existing note can be updated cleanly",
    );
    expect(taskPrompt).toContain("Use memory_note_read before memory_note_edit");
    expect(taskPrompt).toContain("Update MEMORY.md whenever the note set changes");
    expect(taskPrompt).toContain("Recent-message safety:");
    expect(taskPrompt).toContain("Do not output NO_REPLY");
  });

  it("spawns a background durable memory agent and emits action events", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-memory-agent-"));
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

    const result = await runDurableMemoryAgentOnce({
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:user-1",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: dir,
      scope: scope!,
      parentForkContext,
      messageCursor: 2,
      newMessageCount: 1,
      maxNotes: 2,
    });

    expect(result).toMatchObject({
      status: "written",
      notesSaved: 1,
      advanceCursor: true,
    });
    expect(runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        specialAgentSpawnSource: "durable-memory",
        maxTurns: 5,
        toolsAllow: [
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
        workspaceDir: dir,
      }),
    );
    const embeddedParams = runEmbeddedPiAgent.mock.calls[0]?.[0] as
      | {
          sessionId?: string;
          sessionFile?: string;
          specialParentPromptEnvelope?: { forkContextMessages?: unknown[] };
          prompt?: string;
          extraSystemPrompt?: string;
        }
      | undefined;
    expect(embeddedParams?.specialParentPromptEnvelope?.forkContextMessages).toEqual(
      fullForkMessages,
    );
    expect(embeddedParams?.prompt).toContain(
      "Analyze the most recent ~1 model-visible messages above",
    );
    expect(embeddedParams?.prompt).not.toContain(
      "Recent model-visible messages since the last extraction cursor",
    );
    expect(embeddedParams?.extraSystemPrompt).toBeUndefined();
    expect(embeddedParams?.sessionId).not.toBe("session-1");
    expect(embeddedParams?.sessionFile).not.toBe("/tmp/session-1.jsonl");
    expect(emitAgentActionEvent).toHaveBeenCalledTimes(3);
    expect(emitAgentActionEvent.mock.calls[0]?.[0]).toMatchObject({
      data: expect.objectContaining({
        kind: "memory",
        status: "started",
        projectedTitle: "Durable memory agent scheduled",
        projectedSummary: "main:feishu:user-1",
        detail: expect.objectContaining({
          memoryKind: "durable_memory",
          memoryPhase: "scheduled",
        }),
      }),
    });
    expect(emitAgentActionEvent.mock.calls[1]?.[0]).toMatchObject({
      data: expect.objectContaining({
        kind: "memory",
        status: "running",
        projectedTitle: "Durable memory agent running",
        projectedSummary: "main:feishu:user-1",
        detail: expect.objectContaining({
          memoryKind: "durable_memory",
          memoryPhase: "running",
        }),
      }),
    });
    expect(emitAgentActionEvent.mock.calls[2]?.[0]).toMatchObject({
      data: expect.objectContaining({
        kind: "memory",
        status: "completed",
        title: "Durable memory agent wrote durable notes",
        projectedTitle: "Durable memory agent wrote durable notes",
        projectedSummary: "saved one durable note",
        detail: expect.objectContaining({
          memoryKind: "durable_memory",
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
          modelVisibleMessageCount: 1,
        }),
      }),
    });
  });

  it("fails closed when the background durable memory agent cannot start", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-durable-memory-agent-"));
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
    const parentForkContext = {
      parentRunId: "parent-run-1",
      provider: "openai",
      modelId: "gpt-5.4",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "parent system prompt",
        forkContextMessages: [makeAgentUserMessage({ content: "以后操作类回答先给步骤。" })],
      }),
    };

    const result = await runDurableMemoryAgentOnce({
      sessionId: "session-1",
      sessionKey: "agent:main:feishu:user-1",
      sessionFile: "/tmp/session-1.jsonl",
      workspaceDir: dir,
      scope: scope!,
      parentForkContext,
      messageCursor: 2,
      newMessageCount: 1,
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
          title: "Durable memory agent did not complete",
          projectedTitle: "Durable memory agent did not complete",
          projectedSummary: "pairing required",
          detail: expect.objectContaining({
            memoryKind: "durable_memory",
            memoryPhase: "wait_failed",
          }),
        }),
      }),
    );
  });
});
