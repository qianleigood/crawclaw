import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";

const mocks = vi.hoisted(() => ({
  finalizeInboundContextWithRust: vi.fn(async (ctx: Record<string, unknown>) => ({
    ...ctx,
    Body: typeof ctx.Body === "string" ? ctx.Body : "",
    BodyForAgent: typeof ctx.BodyForAgent === "string" ? ctx.BodyForAgent : ctx.Body,
    BodyForCommands: typeof ctx.BodyForCommands === "string" ? ctx.BodyForCommands : ctx.Body,
    CommandAuthorized: ctx.CommandAuthorized === true,
  })),
  runCrawClawRuntimeTool: vi.fn(),
}));

vi.mock("./inbound-policy-runtime.js", () => ({
  finalizeInboundContextWithRust: mocks.finalizeInboundContextWithRust,
}));

vi.mock("../agents/runtime-tools/native.js", () => ({
  runCrawClawRuntimeTool: mocks.runCrawClawRuntimeTool,
}));

import {
  dispatchInboundMessage,
  dispatchInboundMessageWithBufferedDispatcher,
  withReplyDispatcher,
} from "./dispatch.js";
import type { ReplyDispatcher } from "./reply/reply-dispatcher.js";
import { buildTestCtx } from "./reply/test-ctx.js";

function rustRunResult(text = "rust ok") {
  return {
    runId: "run-rust",
    sessionKey: "agent:main:main",
    assistantText: text,
    events: [
      {
        type: "replyPayload",
        runId: "run-rust",
        payload: { text },
      },
      {
        type: "runCompleted",
        runId: "run-rust",
      },
    ],
  };
}

function createDispatcher(record: string[]): ReplyDispatcher {
  return {
    sendToolResult: () => true,
    sendBlockReply: () => true,
    sendFinalReply: () => true,
    getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
    getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
    markComplete: () => {
      record.push("markComplete");
    },
    waitForIdle: async () => {
      record.push("waitForIdle");
    },
  };
}

beforeEach(() => {
  mocks.finalizeInboundContextWithRust.mockClear();
  mocks.runCrawClawRuntimeTool.mockReset();
  mocks.runCrawClawRuntimeTool.mockImplementation(async (tool: string, input: unknown) => {
    if (tool === "agent_run_turn") {
      return rustRunResult();
    }
    const operation =
      input && typeof input === "object" && "operation" in input ? (input.operation as string) : "";
    if (tool === "message_policy" && operation === "outbound.resolveReplyRoutingDecision") {
      return {
        isInternalWebchatTurn: false,
        shouldRouteToOriginating: false,
        shouldSuppressTyping: false,
      };
    }
    if (tool === "message_policy" && operation === "outbound.resolveTypingPolicy") {
      return {
        typingPolicy: "user_message",
        suppressTyping: false,
      };
    }
    throw new Error(`unexpected runtime tool ${tool}`);
  });
});

describe("withReplyDispatcher", () => {
  it("always marks complete and waits for idle after success", async () => {
    const order: string[] = [];
    const dispatcher = createDispatcher(order);

    const result = await withReplyDispatcher({
      dispatcher,
      run: async () => {
        order.push("run");
        return "ok";
      },
      onSettled: () => {
        order.push("onSettled");
      },
    });

    expect(result).toBe("ok");
    expect(order).toEqual(["run", "markComplete", "waitForIdle", "onSettled"]);
  });

  it("still drains dispatcher after run throws", async () => {
    const order: string[] = [];
    const dispatcher = createDispatcher(order);
    const onSettled = vi.fn(() => {
      order.push("onSettled");
    });

    await expect(
      withReplyDispatcher({
        dispatcher,
        run: async () => {
          order.push("run");
          throw new Error("boom");
        },
        onSettled,
      }),
    ).rejects.toThrow("boom");

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["run", "markComplete", "waitForIdle", "onSettled"]);
  });

  it("dispatchInboundMessage owns dispatcher lifecycle for test-only reply resolver compatibility", async () => {
    const order: string[] = [];
    const dispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply: () => {
        order.push("sendFinalReply");
        return true;
      },
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: () => {
        order.push("markComplete");
      },
      waitForIdle: async () => {
        order.push("waitForIdle");
      },
    } satisfies ReplyDispatcher;

    await dispatchInboundMessage({
      ctx: buildTestCtx(),
      cfg: {} as CrawClawConfig,
      dispatcher,
      replyResolver: async () => ({ text: "ok" }),
    });

    expect(
      mocks.runCrawClawRuntimeTool.mock.calls.some(([tool]) => tool === "agent_run_turn"),
    ).toBe(false);
    expect(order).toEqual(["sendFinalReply", "markComplete", "waitForIdle"]);
  });

  it("keeps production inbound dispatch on Rust agent.runTurn even when a reply resolver is passed", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalVitest = process.env.VITEST;
    process.env.NODE_ENV = "production";
    delete process.env.VITEST;
    try {
      const order: string[] = [];
      const dispatcher = {
        sendToolResult: () => true,
        sendBlockReply: () => true,
        sendFinalReply: (payload) => {
          order.push(`sendFinalReply:${payload.text ?? ""}`);
          return true;
        },
        getQueuedCounts: () => ({ tool: 0, block: 0, final: 1 }),
        getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
        markComplete: () => {
          order.push("markComplete");
        },
        waitForIdle: async () => {
          order.push("waitForIdle");
        },
      } satisfies ReplyDispatcher;
      const replyResolver = vi.fn(async () => ({ text: "ts fallback" }));

      await dispatchInboundMessage({
        ctx: buildTestCtx({ Body: "production hello" }),
        cfg: {} as CrawClawConfig,
        dispatcher,
        replyResolver,
      });

      expect(replyResolver).not.toHaveBeenCalled();
      expect(
        mocks.runCrawClawRuntimeTool.mock.calls.some(([tool]) => tool === "agent_run_turn"),
      ).toBe(true);
      expect(order).toEqual(["sendFinalReply:rust ok", "markComplete", "waitForIdle"]);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalVitest === undefined) {
        delete process.env.VITEST;
      } else {
        process.env.VITEST = originalVitest;
      }
    }
  });

  it("routes the default inbound agent loop through Rust agent.runTurn", async () => {
    const order: string[] = [];
    const dispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply: (payload) => {
        order.push(`sendFinalReply:${payload.text ?? ""}`);
        return true;
      },
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 1 }),
      getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: () => {
        order.push("markComplete");
      },
      waitForIdle: async () => {
        order.push("waitForIdle");
      },
    } satisfies ReplyDispatcher;

    const onAgentRunStart = vi.fn();
    await dispatchInboundMessage({
      ctx: buildTestCtx({
        Body: "hello",
        MessageSid: "msg-1",
        SessionKey: "agent:main:whatsapp:direct:+1000",
      }),
      cfg: {} as CrawClawConfig,
      dispatcher,
      replyOptions: {
        runId: "run-test",
        onAgentRunStart,
      },
    });

    expect(onAgentRunStart).toHaveBeenCalledWith("run-test");
    expect(mocks.runCrawClawRuntimeTool).toHaveBeenCalledWith(
      "agent_run_turn",
      expect.objectContaining({
        runId: "run-test",
        sessionKey: "agent:main:whatsapp:direct:+1000",
        inbound: expect.objectContaining({
          body: "hello",
          channel: "whatsapp",
          messageId: "msg-1",
        }),
      }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(order).toEqual(["sendFinalReply:rust ok", "markComplete", "waitForIdle"]);
  });

  it("dispatchInboundMessageWithBufferedDispatcher cleans up typing after a resolver starts it", async () => {
    const typing = {
      onReplyStart: vi.fn(async () => {}),
      startTypingLoop: vi.fn(async () => {}),
      startTypingOnText: vi.fn(async () => {}),
      refreshTypingTtl: vi.fn(),
      isActive: vi.fn(() => true),
      markRunComplete: vi.fn(),
      markDispatchIdle: vi.fn(),
      cleanup: vi.fn(),
    };

    await dispatchInboundMessageWithBufferedDispatcher({
      ctx: buildTestCtx(),
      cfg: {} as CrawClawConfig,
      dispatcherOptions: {
        deliver: async () => undefined,
      },
      replyResolver: async (_ctx, opts) => {
        opts?.onTypingController?.(typing);
        return { text: "ok" };
      },
    });

    expect(typing.markRunComplete).toHaveBeenCalledTimes(1);
    expect(typing.markDispatchIdle).toHaveBeenCalled();
  });
});
