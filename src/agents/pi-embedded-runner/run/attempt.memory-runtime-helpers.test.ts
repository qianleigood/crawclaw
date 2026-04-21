import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerRunLoopLifecycleHandler,
  resetRunLoopLifecycleHandlersForTests,
} from "../../runtime/lifecycle/bus.js";
import { buildSpecialAgentCacheEnvelope } from "../../special/runtime/parent-fork-context.js";
import { finalizeAttemptMemoryRuntimeTurn } from "./attempt.memory-runtime-helpers.js";

beforeEach(() => {
  resetRunLoopLifecycleHandlersForTests();
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
      parentForkContext?: {
        parentRunId?: string;
        promptEnvelope?: { forkContextMessages?: unknown[] };
      };
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
        parentForkContext:
          event.metadata?.parentForkContext && typeof event.metadata.parentForkContext === "object"
            ? (event.metadata.parentForkContext as {
                parentRunId?: string;
                promptEnvelope?: { forkContextMessages?: unknown[] };
              })
            : undefined,
      });
    });
    const messagesSnapshot = [{ role: "assistant", content: "done" }] as unknown as AgentMessage[];
    const parentForkContext = {
      parentRunId: "run-1",
      provider: "openai",
      modelId: "gpt-5.4",
      promptEnvelope: buildSpecialAgentCacheEnvelope({
        systemPromptText: "parent system",
        toolNames: ["read"],
        toolPromptPayload: [{ name: "read" }],
        thinkingConfig: {},
        forkContextMessages: messagesSnapshot,
      }),
    };

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
      messagesSnapshot,
      parentForkContext,
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
        parentForkContext,
      },
      {
        phase: "settled_turn",
        sessionId: "session-1",
        sessionKey: "agent:main:feishu:user-1",
        workspaceDir: "/tmp/workspace",
        parentForkContext,
      },
      {
        phase: "stop",
        sessionId: "session-1",
        sessionKey: "agent:main:feishu:user-1",
        workspaceDir: "/tmp/workspace",
        parentForkContext,
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
