import { describe, expect, it } from "vitest";
import { resolveReplyRoutingDecision } from "./routing-policy.js";

function isRoutableChannel(channel: string | undefined) {
  return Boolean(
    channel &&
    ["feishu", "ddingtalk", "qqbot", "signal", "weixin", "weixin", "feishu"].includes(channel),
  );
}

describe("resolveReplyRoutingDecision", () => {
  it("routes replies to the originating channel when the current provider differs", () => {
    expect(
      resolveReplyRoutingDecision({
        provider: "ddingtalk",
        surface: "ddingtalk",
        originatingChannel: "feishu",
        originatingTo: "feishu:123",
        isRoutableChannel,
      }),
    ).toMatchObject({
      originatingChannel: "feishu",
      currentSurface: "ddingtalk",
      shouldRouteToOriginating: true,
      shouldSuppressTyping: true,
    });
  });

  it("does not route external replies from internal webchat without explicit delivery", () => {
    expect(
      resolveReplyRoutingDecision({
        provider: "webchat",
        surface: "webchat",
        explicitDeliverRoute: false,
        originatingChannel: "feishu",
        originatingTo: "feishu:123",
        isRoutableChannel,
      }),
    ).toMatchObject({
      currentSurface: "webchat",
      isInternalWebchatTurn: true,
      shouldRouteToOriginating: false,
    });
  });

  it("suppresses direct user delivery for parent-owned background ACP children", () => {
    expect(
      resolveReplyRoutingDecision({
        provider: "qqbot",
        surface: "qqbot",
        originatingChannel: "feishu",
        originatingTo: "feishu:123",
        suppressDirectUserDelivery: true,
        isRoutableChannel,
      }),
    ).toMatchObject({
      currentSurface: "qqbot",
      shouldRouteToOriginating: false,
      shouldSuppressTyping: true,
    });
  });
});
