import { expect, vi } from "vitest";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import type { CliDeps } from "../cli/deps.js";
import { runCronIsolatedAgentTurn } from "./isolated-agent.js";
import { makeCfg, makeJob } from "./isolated-agent.test-harness.js";

export function createCliDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  const sendMessageFeishu = vi.fn().mockResolvedValue({ messageId: "feishu-1", chatId: "123" });
  const sendMessageWeixin = vi
    .fn()
    .mockResolvedValue({ messageId: "weixin-1", conversationId: "123" });
  const sendMessageQQ = vi.fn().mockResolvedValue({ messageId: "qq-1", channelId: "123" });
  const sendMessageDingTalk = vi
    .fn()
    .mockResolvedValue({ messageId: "ddingtalk-1", channel: "C1" });
  const sendMessageESP32 = vi.fn().mockResolvedValue({ messageId: "esp32-1", chatId: "123" });
  return {
    feishu: sendMessageFeishu,
    weixin: sendMessageWeixin,
    qqbot: sendMessageQQ,
    ddingtalk: sendMessageDingTalk,
    esp32: sendMessageESP32,
    sendMessageFeishu,
    sendMessageWeixin,
    sendMessageQQ,
    sendMessageDingTalk,
    sendMessageESP32,
    ...overrides,
  };
}

export function mockAgentPayloads(
  payloads: Array<Record<string, unknown>>,
  extra: Partial<Awaited<ReturnType<typeof runEmbeddedPiAgent>>> = {},
): void {
  vi.mocked(runEmbeddedPiAgent).mockResolvedValue({
    payloads,
    meta: {
      durationMs: 5,
      agentMeta: { sessionId: "s", provider: "p", model: "m" },
    },
    ...extra,
  });
}

export function expectDirectFeishuDelivery(
  deps: CliDeps,
  params: { chatId: string; text: string; messageThreadId?: number },
) {
  expect(deps.sendMessageFeishu).toHaveBeenCalledTimes(1);
  expect(deps.sendMessageFeishu).toHaveBeenCalledWith(
    params.chatId,
    params.text,
    expect.objectContaining(
      params.messageThreadId === undefined ? {} : { messageThreadId: params.messageThreadId },
    ),
  );
}

export async function runFeishuAnnounceTurn(params: {
  home: string;
  storePath: string;
  deps: CliDeps;
  delivery: {
    mode: "announce";
    channel: string;
    to?: string;
    bestEffort?: boolean;
  };
  deliveryContract?: "cron-owned" | "shared";
}): Promise<Awaited<ReturnType<typeof runCronIsolatedAgentTurn>>> {
  return runCronIsolatedAgentTurn({
    cfg: makeCfg(params.home, params.storePath, {
      channels: { feishu: { enabled: true } },
    }),
    deps: params.deps,
    job: {
      ...makeJob({ kind: "agentTurn", message: "do it" }),
      delivery: params.delivery,
    },
    message: "do it",
    sessionKey: "cron:job-1",
    lane: "cron",
    deliveryContract: params.deliveryContract,
  });
}
