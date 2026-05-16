import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callGateway } from "../../gateway/call.js";
import { resolveReplyRoutingDecisionWithRust } from "./routing-policy-runtime.js";

vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

const callGatewayMock = vi.mocked(callGateway);

describe("resolveReplyRoutingDecisionWithRust", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
  });

  it("uses the Rust message policy worker operation", async () => {
    callGatewayMock.mockResolvedValue({
      originatingChannel: "feishu",
      currentSurface: "ddingtalk",
      isInternalWebchatTurn: false,
      shouldRouteToOriginating: true,
      shouldSuppressTyping: true,
    });

    const decision = await resolveReplyRoutingDecisionWithRust({
      provider: "DingTalk",
      surface: "ddingtalk",
      originatingChannel: "Feishu",
      originatingTo: "feishu:123",
      isRoutableChannel: (channel) => channel === "feishu",
    });

    expect(decision.shouldRouteToOriginating).toBe(true);
    expect(callGatewayMock).toHaveBeenCalledWith({
      method: "message.policy",
      params: {
        operation: "outbound.resolveReplyRoutingDecision",
        payload: {
          provider: "dingtalk",
          surface: "ddingtalk",
          explicitDeliverRoute: undefined,
          originatingChannel: "feishu",
          originatingTo: "feishu:123",
          suppressDirectUserDelivery: undefined,
          originatingRoutable: true,
        },
      },
      timeoutMs: 30_000,
    });
  });

  it("normalizes nullable Rust channels to undefined", async () => {
    callGatewayMock.mockResolvedValue({
      originatingChannel: null,
      currentSurface: null,
      isInternalWebchatTurn: false,
      shouldRouteToOriginating: false,
      shouldSuppressTyping: false,
    });

    const decision = await resolveReplyRoutingDecisionWithRust({
      isRoutableChannel: () => false,
    });

    expect(decision.originatingChannel).toBeUndefined();
    expect(decision.currentSurface).toBeUndefined();
  });

  it("keeps auto-reply dispatch on the Rust agent adapter", () => {
    const source = fs.readFileSync(new URL("../dispatch.ts", import.meta.url), "utf8");

    expect(source).toContain("dispatchInboundWithRustAgent");
    expect(source).not.toContain("dispatchReplyFromConfig");
  });
});
