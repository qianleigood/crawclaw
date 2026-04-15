import type { StreamFn } from "@mariozechner/pi-agent-core";
import { createAssistantMessageEventStream, type Context, type Model } from "@mariozechner/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerRunLoopLifecycleHandler,
  resetRunLoopLifecycleHandlersForTests,
} from "../../runtime/lifecycle/bus.js";
import type { RunLoopLifecycleEvent } from "../../runtime/lifecycle/types.js";
import { wrapStreamFnWithProviderLifecycle } from "./attempt.provider-lifecycle.js";

const model = {
  api: "anthropic-messages",
  provider: "anthropic",
  id: "claude-sonnet-4-6",
} as Model<"anthropic-messages">;

const snapshot = {
  queryContextHash: "ctx-hash",
  promptChars: 120,
  systemPromptChars: 48,
  sectionTokenUsage: {
    totalEstimatedTokens: 32,
    byRole: {
      system_prompt: 32,
      system_context: 0,
      user_context: 0,
    },
    byType: {
      other: 32,
    },
  },
  sectionOrder: [
    {
      id: "system",
      role: "system_prompt" as const,
      sectionType: "other" as const,
      estimatedTokens: 32,
    },
  ],
};

describe("wrapStreamFnWithProviderLifecycle", () => {
  beforeEach(() => {
    resetRunLoopLifecycleHandlersForTests();
  });

  it("emits start and stop events for a successful provider stream", async () => {
    const events: RunLoopLifecycleEvent[] = [];
    registerRunLoopLifecycleHandler("*", (event) => {
      events.push(event);
    });

    const baseStreamFn: StreamFn = () => {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.end();
      });
      return stream;
    };

    const wrapped = wrapStreamFnWithProviderLifecycle({
      streamFn: baseStreamFn,
      runId: "run-1",
      sessionId: "session-1",
      sessionKey: "agent:main:discord:user-1",
      agentId: "main",
      sessionFile: "/tmp/session.jsonl",
      isTopLevel: true,
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      modelApi: "anthropic-messages",
      getProviderRequestSnapshot: () => snapshot,
      getMessageCount: () => 3,
    });

    const stream = await Promise.resolve(wrapped(model, { messages: [] } as Context, {}));
    for await (const _ of stream) {
      // consume to completion
    }

    await vi.waitFor(() => {
      expect(events).toHaveLength(2);
    });
    expect(events[0]).toEqual(
      expect.objectContaining({
        phase: "provider_request_start",
        runId: "run-1",
        sessionId: "session-1",
        decision: expect.objectContaining({ code: "provider_model_selected" }),
        metrics: expect.objectContaining({
          promptChars: 120,
          systemPromptChars: 48,
          sectionCount: 1,
          messageCount: 3,
        }),
        refs: expect.objectContaining({
          provider: "anthropic",
          modelId: "claude-sonnet-4-6",
          queryContextHash: "ctx-hash",
        }),
      }),
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        phase: "provider_request_stop",
        decision: expect.objectContaining({ code: "provider_request_completed" }),
      }),
    );
    expect(events[0]?.spanId).toBe(events[1]?.spanId);
  });

  it("emits an error event when the provider stream throws synchronously", async () => {
    const events: RunLoopLifecycleEvent[] = [];
    registerRunLoopLifecycleHandler("*", (event) => {
      events.push(event);
    });

    const baseStreamFn: StreamFn = () => {
      throw new Error("provider boom");
    };

    const wrapped = wrapStreamFnWithProviderLifecycle({
      streamFn: baseStreamFn,
      runId: "run-2",
      sessionId: "session-2",
      isTopLevel: false,
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      modelApi: "anthropic-messages",
      getProviderRequestSnapshot: () => snapshot,
    });

    expect(() => wrapped(model, { messages: [] } as Context, {})).toThrow("provider boom");
    await vi.waitFor(() => {
      expect(events).toHaveLength(2);
    });
    expect(events[0]).toEqual(
      expect.objectContaining({
        phase: "provider_request_start",
      }),
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        phase: "provider_request_error",
        error: "provider boom",
        decision: expect.objectContaining({ code: "provider_request_failed" }),
      }),
    );
    expect(events[0]?.spanId).toBe(events[1]?.spanId);
  });
});
