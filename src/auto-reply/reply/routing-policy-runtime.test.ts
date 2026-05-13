import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCrawClawRuntimeTool } from "../../agents/runtime-tools/native.js";
import { resolveReplyRoutingDecisionWithRust } from "./routing-policy-runtime.js";

vi.mock("../../agents/runtime-tools/native.js", () => ({
  runCrawClawRuntimeTool: vi.fn(),
}));

const runRuntimeTool = vi.mocked(runCrawClawRuntimeTool);

describe("resolveReplyRoutingDecisionWithRust", () => {
  beforeEach(() => {
    runRuntimeTool.mockReset();
  });

  it("uses the Rust message policy worker operation", async () => {
    runRuntimeTool.mockResolvedValue({
      originatingChannel: "telegram",
      currentSurface: "slack",
      isInternalWebchatTurn: false,
      shouldRouteToOriginating: true,
      shouldSuppressTyping: true,
    });

    const decision = await resolveReplyRoutingDecisionWithRust({
      provider: "Slack",
      surface: "slack",
      originatingChannel: "Telegram",
      originatingTo: "telegram:123",
      isRoutableChannel: (channel) => channel === "telegram",
    });

    expect(decision.shouldRouteToOriginating).toBe(true);
    expect(runRuntimeTool).toHaveBeenCalledWith(
      "message_policy",
      {
        operation: "outbound.resolveReplyRoutingDecision",
        payload: {
          provider: "slack",
          surface: "slack",
          explicitDeliverRoute: undefined,
          originatingChannel: "telegram",
          originatingTo: "telegram:123",
          suppressDirectUserDelivery: undefined,
          originatingRoutable: true,
        },
      },
      { timeoutMs: 30_000 },
    );
  });

  it("normalizes nullable Rust channels to undefined", async () => {
    runRuntimeTool.mockResolvedValue({
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

  it("keeps dispatch reply routing on the Rust policy adapter", () => {
    const source = fs.readFileSync(new URL("./dispatch-from-config.ts", import.meta.url), "utf8");

    expect(source).toContain("./routing-policy-runtime.js");
    expect(source).not.toContain("./routing-policy.js");
  });
});
