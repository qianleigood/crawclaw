import type { AssistantMessage } from "@mariozechner/pi-ai";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  loadRunOverflowCompactionHarness,
  mockedEnsureRuntimePluginsLoaded,
  mockedMaybeRunExplicitDurableIntentGate,
  mockedRunEmbeddedAttempt,
} from "./run.overflow-compaction.harness.js";
import type { EmbeddedRunAttemptResult } from "./run/types.js";

let runEmbeddedPiAgent: typeof import("./run.js").runEmbeddedPiAgent;

function makeAttemptResult(
  overrides: Partial<EmbeddedRunAttemptResult> = {},
): EmbeddedRunAttemptResult {
  return {
    aborted: false,
    timedOut: false,
    timedOutDuringCompaction: false,
    promptError: null,
    sessionIdUsed: "test-session",
    messagesSnapshot: [],
    assistantTexts: [],
    toolMetas: [],
    lastAssistant: undefined,
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    ...overrides,
  };
}

function makeAssistantMessage(
  overrides: Partial<AssistantMessage> = {},
): NonNullable<EmbeddedRunAttemptResult["lastAssistant"]> {
  return {
    role: "assistant",
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5.2",
    usage: { input: 0, output: 0 } as AssistantMessage["usage"],
    stopReason: "end_turn" as AssistantMessage["stopReason"],
    timestamp: Date.now(),
    content: [],
    ...overrides,
  };
}

describe("runEmbeddedPiAgent usage reporting", () => {
  beforeAll(async () => {
    ({ runEmbeddedPiAgent } = await loadRunOverflowCompactionHarness());
  });

  beforeEach(() => {
    mockedEnsureRuntimePluginsLoaded.mockReset();
    mockedMaybeRunExplicitDurableIntentGate.mockReset();
    mockedRunEmbeddedAttempt.mockReset();
  });

  it("bootstraps runtime plugins with the resolved workspace before running", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        assistantTexts: ["Response 1"],
      }),
    );

    await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "hello",
      timeoutMs: 30000,
      runId: "run-plugin-bootstrap",
    });

    expect(mockedEnsureRuntimePluginsLoaded).toHaveBeenCalledWith({
      config: undefined,
      workspaceDir: "/tmp/workspace",
    });
  });

  it("forwards gateway subagent binding opt-in to runtime plugin bootstrap", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        assistantTexts: ["Response 1"],
      }),
    );

    await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "hello",
      timeoutMs: 30000,
      runId: "run-gateway-bind",
      allowGatewaySubagentBinding: true,
    });

    expect(mockedEnsureRuntimePluginsLoaded).toHaveBeenCalledWith({
      config: undefined,
      workspaceDir: "/tmp/workspace",
      allowGatewaySubagentBinding: true,
    });
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        allowGatewaySubagentBinding: true,
      }),
    );
  });

  it("forwards sender identity fields into embedded attempts", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        assistantTexts: ["Response 1"],
      }),
    );

    await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "hello",
      timeoutMs: 30000,
      runId: "run-sender-forwarding",
      senderId: "user-123",
      senderName: "Josh Lehman",
      senderUsername: "josh",
      senderE164: "+15551234567",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: "user-123",
        senderName: "Josh Lehman",
        senderUsername: "josh",
        senderE164: "+15551234567",
      }),
    );
  });

  it("forwards toolsAllow into embedded attempts", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        assistantTexts: ["Response 1"],
      }),
    );

    await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "hello",
      timeoutMs: 30000,
      runId: "run-tools-allow-forwarding",
      toolsAllow: ["memory_note_write", "memory_note_delete"],
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        toolsAllow: ["memory_note_write", "memory_note_delete"],
      }),
    );
  });

  it("forwards special-agent runtime context into embedded attempts", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        assistantTexts: ["Response 1"],
      }),
    );

    await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "judge this candidate",
      timeoutMs: 30000,
      runId: "run-special-agent-forwarding",
      specialAgentSpawnSource: "promotion-judge",
      specialDurableMemoryScope: {
        agentId: "main",
        channel: "local",
        userId: "owner",
      },
      specialTranscriptSearch: {
        sessionIds: ["session-a"],
        maxSessions: 2,
      },
      specialSessionSummaryTarget: {
        agentId: "main",
        sessionId: "summary-session",
      },
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        specialAgentSpawnSource: "promotion-judge",
        specialDurableMemoryScope: {
          agentId: "main",
          channel: "local",
          userId: "owner",
        },
        specialTranscriptSearch: {
          sessionIds: ["session-a"],
          maxSessions: 2,
        },
        specialSessionSummaryTarget: {
          agentId: "main",
          sessionId: "summary-session",
        },
      }),
    );
  });

  it("appends durable tool-call instructions to the attempt system prompt", async () => {
    mockedMaybeRunExplicitDurableIntentGate.mockResolvedValueOnce({
      applied: false,
      intent: "remember",
      notesSaved: 0,
      forcedToolName: "memory_manifest_read",
      toolChoice: { type: "tool", name: "memory_manifest_read" },
      systemPromptInstruction:
        "must start the durable-memory workflow with the memory_manifest_read tool",
    });
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        assistantTexts: ["Response 1"],
      }),
    );

    await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "记住这个：以后回答操作类问题先给步骤。",
      timeoutMs: 30000,
      runId: "run-durable-intent-gate",
      extraSystemPrompt: "existing extra",
      toolsAllow: ["memory_manifest_read"],
      senderId: "user-1",
      messageChannel: "feishu",
    });

    expect(mockedMaybeRunExplicitDurableIntentGate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "记住这个：以后回答操作类问题先给步骤。",
        toolsAllow: ["memory_manifest_read"],
      }),
    );
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        extraSystemPrompt: expect.stringContaining("existing extra"),
      }),
    );
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        extraSystemPrompt: expect.stringContaining(
          "must start the durable-memory workflow with the memory_manifest_read tool",
        ),
      }),
    );
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        streamParams: expect.objectContaining({
          toolChoice: { type: "tool", name: "memory_manifest_read" },
        }),
      }),
    );
  });

  it("forces the main agent to self-call the durable tool on the narrow durable-only path", async () => {
    mockedMaybeRunExplicitDurableIntentGate.mockResolvedValueOnce({
      applied: false,
      intent: "remember",
      notesSaved: 0,
      forcedToolName: "memory_manifest_read",
      toolChoice: { type: "tool", name: "memory_manifest_read" },
      systemPromptInstruction: "must call the durable tool first",
    });
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        assistantTexts: ["Response 1"],
      }),
    );

    await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "记住这个：以后回答操作类问题先给步骤。",
      timeoutMs: 30000,
      runId: "run-durable-toolchoice-forwarding",
      toolsAllow: ["memory_manifest_read"],
      streamParams: { temperature: 0.2 },
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        streamParams: {
          temperature: 0.2,
          toolChoice: { type: "tool", name: "memory_manifest_read" },
        },
      }),
    );
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        extraSystemPrompt: expect.stringContaining("must call the durable tool first"),
      }),
    );
  });

  it("forwards memory flush write paths into memory-triggered attempts", async () => {
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        assistantTexts: [],
      }),
    );

    await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "flush",
      timeoutMs: 30000,
      runId: "run-memory-forwarding",
      trigger: "memory",
      memoryFlushWritePath: "memory/2026-03-10.md",
    });

    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "memory",
        memoryFlushWritePath: "memory/2026-03-10.md",
      }),
    );
  });

  it("reports total usage from the last turn instead of accumulated total", async () => {
    // Simulate a multi-turn run result.
    // Turn 1: Input 100, Output 50. Total 150.
    // Turn 2: Input 150, Output 50. Total 200.

    // The accumulated usage (attemptUsage) will be the sum:
    // Input: 100 + 150 = 250 (Note: runEmbeddedAttempt actually returns accumulated usage)
    // Output: 50 + 50 = 100
    // Total: 150 + 200 = 350

    // The last assistant usage (lastAssistant.usage) will be Turn 2:
    // Input: 150, Output 50, Total 200.

    // We expect result.meta.agentMeta.usage.total to be 200 (last turn total).
    // The bug causes it to be 350 (accumulated total).

    mockedRunEmbeddedAttempt.mockResolvedValueOnce(
      makeAttemptResult({
        assistantTexts: ["Response 1", "Response 2"],
        lastAssistant: makeAssistantMessage({
          usage: { input: 150, output: 50, total: 200 } as unknown as AssistantMessage["usage"],
        }),
        attemptUsage: { input: 250, output: 100, total: 350 },
      }),
    );

    const result = await runEmbeddedPiAgent({
      sessionId: "test-session",
      sessionKey: "test-key",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp/workspace",
      prompt: "hello",
      timeoutMs: 30000,
      runId: "run-1",
    });

    // Check usage in meta
    const usage = result.meta.agentMeta?.usage;
    expect(usage).toBeDefined();

    // Check if total matches the last turn's total (200)
    // If the bug exists, it will likely be 350
    expect(usage?.total).toBe(200);
  });
});
