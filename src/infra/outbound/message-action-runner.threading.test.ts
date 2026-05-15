import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import {
  prepareOutboundMirrorRoute,
  resolveAndApplyOutboundThreadId,
} from "./message-action-threading.js";

const ensureOutboundSessionEntry = vi.fn(async () => undefined);
const resolveOutboundSessionRoute = vi.fn();

const ddingtalkConfig = {
  channels: {
    ddingtalk: {
      botToken: "xoxb-test",
    },
  },
} as CrawClawConfig;

const feishuConfig = {
  channels: {
    feishu: {
      botToken: "feishu-test",
    },
  },
} as CrawClawConfig;

const defaultFeishuToolContext = {
  currentChannelId: "feishu:123",
  currentThreadTs: "42",
} as const;

describe("message action threading helpers", () => {
  beforeEach(() => {
    ensureOutboundSessionEntry.mockClear();
    resolveOutboundSessionRoute.mockReset();
  });

  it.each([
    {
      name: "exact channel id",
      target: "channel:C123",
      threadTs: "111.222",
      expectedSessionKey: "agent:main:ddingtalk:channel:c123:thread:111.222",
    },
    {
      name: "case-insensitive channel id",
      target: "channel:c123",
      threadTs: "333.444",
      expectedSessionKey: "agent:main:ddingtalk:channel:c123:thread:333.444",
    },
  ] as const)("prepares outbound routes for ddingtalk using $name", async (testCase) => {
    const actionParams: Record<string, unknown> = {
      channel: "ddingtalk",
      target: testCase.target,
      message: "hi",
    };
    resolveOutboundSessionRoute.mockResolvedValue({
      sessionKey: testCase.expectedSessionKey,
      baseSessionKey: "base",
      peer: { id: "peer", kind: "channel" },
      chatType: "channel",
      from: "from",
      to: testCase.target,
      threadId: testCase.threadTs,
    });

    const result = await prepareOutboundMirrorRoute({
      cfg: ddingtalkConfig,
      channel: "ddingtalk",
      to: testCase.target,
      actionParams,
      toolContext: {
        currentChannelId: "C123",
        currentThreadTs: testCase.threadTs,
        replyToMode: "all",
      },
      agentId: "main",
      resolveAutoThreadId: ({ toolContext }) => toolContext?.currentThreadTs,
      resolveOutboundSessionRoute,
      ensureOutboundSessionEntry,
    });

    expect(result.outboundRoute?.sessionKey).toBe(testCase.expectedSessionKey);
    expect(actionParams.__sessionKey).toBe(testCase.expectedSessionKey);
    expect(actionParams.__agentId).toBe("main");
    expect(ensureOutboundSessionEntry).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "injects threadId for matching target",
      target: "feishu:123",
      expectedThreadId: "42",
    },
    {
      name: "injects threadId for prefixed group target",
      target: "feishu:group:123",
      expectedThreadId: "42",
    },
    {
      name: "skips threadId when target chat differs",
      target: "feishu:999",
      expectedThreadId: undefined,
    },
  ] as const)("feishu auto-threading: $name", (testCase) => {
    const actionParams: Record<string, unknown> = {
      channel: "feishu",
      target: testCase.target,
      message: "hi",
    };

    const resolved = resolveAndApplyOutboundThreadId(actionParams, {
      cfg: feishuConfig,
      to: testCase.target,
      toolContext: defaultFeishuToolContext,
      resolveAutoThreadId: ({ to, toolContext }) =>
        to.includes("123") ? toolContext?.currentThreadTs : undefined,
    });

    expect(actionParams.threadId).toBe(testCase.expectedThreadId);
    expect(resolved).toBe(testCase.expectedThreadId);
  });

  it("uses explicit feishu threadId when provided", () => {
    const actionParams: Record<string, unknown> = {
      channel: "feishu",
      target: "feishu:123",
      message: "hi",
      threadId: "999",
    };

    const resolved = resolveAndApplyOutboundThreadId(actionParams, {
      cfg: feishuConfig,
      to: "feishu:123",
      toolContext: defaultFeishuToolContext,
      resolveAutoThreadId: () => "42",
    });

    expect(actionParams.threadId).toBe("999");
    expect(resolved).toBe("999");
  });

  it("passes explicit replyTo into auto-thread resolution", () => {
    const resolveAutoThreadId = vi.fn(() => "thread-777");
    const actionParams: Record<string, unknown> = {
      channel: "feishu",
      target: "feishu:123",
      message: "hi",
      replyTo: "777",
    };

    const resolved = resolveAndApplyOutboundThreadId(actionParams, {
      cfg: feishuConfig,
      to: "feishu:123",
      toolContext: defaultFeishuToolContext,
      resolveAutoThreadId,
    });

    expect(resolveAutoThreadId).toHaveBeenCalledWith(
      expect.objectContaining({
        replyToId: "777",
      }),
    );
    expect(resolved).toBe("thread-777");
    expect(actionParams.threadId).toBe("thread-777");
  });
});
