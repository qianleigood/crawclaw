import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerRunLoopLifecycleHandler,
  resetRunLoopLifecycleHandlersForTests,
} from "../../runtime/lifecycle/bus.js";
import {
  finalizeAttemptMemoryRuntimeTurn,
  startAttemptMemoryRuntimeDurableRecallPrefetch,
} from "./attempt.memory-runtime-helpers.js";

beforeEach(() => {
  resetRunLoopLifecycleHandlersForTests();
});

describe("startAttemptMemoryRuntimeDurableRecallPrefetch", () => {
  it("threads a prefetch handle into runtime context when supported", async () => {
    const handle = {
      sessionId: "session-1",
      sessionKey: "agent:main:discord:user-1",
      prompt: "remember this durable preference",
      scopeKey: "main:discord:user-1",
      startedAt: Date.now(),
      status: "pending" as const,
      promise: Promise.resolve(),
    };
    const startDurableRecallPrefetch = vi.fn(() => handle);

    const runtimeContext = await startAttemptMemoryRuntimeDurableRecallPrefetch({
      memoryRuntime: {
        info: { id: "builtin-memory", name: "Memory" },
        ingest: async () => ({ ingested: true }),
        compact: async () => ({ ok: false, compacted: false }),
        assemble: async () => ({ messages: [], estimatedTokens: 0 }),
        startDurableRecallPrefetch,
      },
      sessionId: "session-1",
      sessionKey: "agent:main:discord:user-1",
      messages: [{ role: "user", content: "remember this durable preference" }] as AgentMessage[],
      modelId: "gpt-test",
      prompt: "remember this durable preference",
      runtimeContext: { agentId: "main" },
      warn: vi.fn(),
    });

    expect(startDurableRecallPrefetch).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        sessionKey: "agent:main:discord:user-1",
        model: "gpt-test",
      }),
    );
    expect(runtimeContext).toEqual(
      expect.objectContaining({
        agentId: "main",
        durableRecallPrefetchHandle: handle,
      }),
    );
  });

  it("falls back to the original runtime context when prefetch startup fails", async () => {
    const warn = vi.fn();

    const runtimeContext = await startAttemptMemoryRuntimeDurableRecallPrefetch({
      memoryRuntime: {
        info: { id: "builtin-memory", name: "Memory" },
        ingest: async () => ({ ingested: true }),
        compact: async () => ({ ok: false, compacted: false }),
        assemble: async () => ({ messages: [], estimatedTokens: 0 }),
        startDurableRecallPrefetch: async () => {
          throw new Error("prefetch failed");
        },
      },
      sessionId: "session-1",
      sessionKey: "agent:main:discord:user-1",
      messages: [{ role: "user", content: "remember this durable preference" }] as AgentMessage[],
      modelId: "gpt-test",
      prompt: "remember this durable preference",
      runtimeContext: { agentId: "main" },
      warn,
    });

    expect(runtimeContext).toEqual({ agentId: "main" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("memory runtime durable recall prefetch failed"),
    );
  });
});

describe("finalizeAttemptMemoryRuntimeTurn", () => {
  it("emits post_sampling, settled_turn, and stop after a successful final top-level turn", async () => {
    const afterTurn = vi.fn();
    const runMaintenance = vi.fn(async () => undefined);
    const lifecycleEvents: Array<{
      phase: string;
      sessionId: string;
      sessionKey?: string;
      workspaceDir?: string;
    }> = [];
    registerRunLoopLifecycleHandler("*", (event) => {
      lifecycleEvents.push({
        phase: event.phase,
        sessionId: event.sessionId,
        sessionKey: event.sessionKey,
        workspaceDir:
          typeof event.metadata?.workspaceDir === "string"
            ? event.metadata.workspaceDir
            : undefined,
      });
    });

    await finalizeAttemptMemoryRuntimeTurn({
      memoryRuntime: {
        info: { id: "builtin-memory", name: "Memory" },
        ingest: async () => ({ ingested: true }),
        compact: async () => ({ ok: false, compacted: false }),
        assemble: async () => ({ messages: [], estimatedTokens: 0 }),
        afterTurn,
      },
      promptError: false,
      aborted: false,
      yieldAborted: false,
      sessionIdUsed: "session-1",
      sessionKey: "agent:main:feishu:user-1",
      sessionFile: "/tmp/session.jsonl",
      messagesSnapshot: [{ role: "assistant", content: "done" }] as unknown as AgentMessage[],
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main", workspaceDir: "/tmp/workspace" },
      runMaintenance,
      sessionManager: {},
      warn: vi.fn(),
    });

    expect(afterTurn).toHaveBeenCalledTimes(1);
    expect(lifecycleEvents).toEqual([
      {
        phase: "post_sampling",
        sessionId: "session-1",
        sessionKey: "agent:main:feishu:user-1",
        workspaceDir: "/tmp/workspace",
      },
      {
        phase: "settled_turn",
        sessionId: "session-1",
        sessionKey: "agent:main:feishu:user-1",
        workspaceDir: "/tmp/workspace",
      },
      {
        phase: "stop",
        sessionId: "session-1",
        sessionKey: "agent:main:feishu:user-1",
        workspaceDir: "/tmp/workspace",
      },
    ]);
    expect(runMaintenance).toHaveBeenCalledTimes(1);
  });

  it("emits stop_failure instead of settled phases when the run ended with a prompt error", async () => {
    const lifecycleEvents: string[] = [];
    registerRunLoopLifecycleHandler("*", (event) => {
      lifecycleEvents.push(event.phase);
    });

    await finalizeAttemptMemoryRuntimeTurn({
      memoryRuntime: {
        info: { id: "builtin-memory", name: "Memory" },
        ingest: async () => ({ ingested: true }),
        compact: async () => ({ ok: false, compacted: false }),
        assemble: async () => ({ messages: [], estimatedTokens: 0 }),
        afterTurn: vi.fn(),
      },
      promptError: true,
      aborted: false,
      yieldAborted: false,
      sessionIdUsed: "session-1",
      sessionKey: "agent:main:feishu:user-1",
      sessionFile: "/tmp/session.jsonl",
      messagesSnapshot: [{ role: "assistant", content: "done" }] as unknown as AgentMessage[],
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main" },
      runMaintenance: vi.fn(async () => undefined),
      sessionManager: {},
      warn: vi.fn(),
    });

    expect(lifecycleEvents).toEqual(["stop_failure"]);
  });

  it("does not emit stop when the turn ends on an assistant tool call", async () => {
    const lifecycleEvents: string[] = [];
    registerRunLoopLifecycleHandler("*", (event) => {
      lifecycleEvents.push(event.phase);
    });

    await finalizeAttemptMemoryRuntimeTurn({
      memoryRuntime: {
        info: { id: "builtin-memory", name: "Memory" },
        ingest: async () => ({ ingested: true }),
        compact: async () => ({ ok: false, compacted: false }),
        assemble: async () => ({ messages: [], estimatedTokens: 0 }),
        afterTurn: vi.fn(),
      },
      promptError: false,
      aborted: false,
      yieldAborted: false,
      sessionIdUsed: "session-1",
      sessionKey: "agent:main:feishu:user-1",
      sessionFile: "/tmp/session.jsonl",
      messagesSnapshot: [
        {
          role: "assistant",
          content: [{ type: "toolUse", id: "call-1", name: "read", input: { path: "MEMORY.md" } }],
          stopReason: "toolUse",
        },
      ] as unknown as AgentMessage[],
      prePromptMessageCount: 0,
      runtimeContext: { agentId: "main" },
      runMaintenance: vi.fn(async () => undefined),
      sessionManager: {},
      warn: vi.fn(),
    });

    expect(lifecycleEvents).toEqual(["post_sampling", "settled_turn"]);
  });
});
