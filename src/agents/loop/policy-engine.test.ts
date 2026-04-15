import { describe, expect, it } from "vitest";
import { decideLoopPolicyAction } from "./policy-engine.js";

describe("policy-engine", () => {
  it("keeps generic warnings as warn actions", () => {
    const decision = decideLoopPolicyAction({
      stuck: true,
      level: "warning",
      detector: "generic_repeat",
      count: 10,
      message: "warning",
    });

    expect(decision).toEqual({
      blocked: false,
      action: "warn",
    });
  });

  it("upgrades high-confidence warning loops to nudges", () => {
    const knownPollDecision = decideLoopPolicyAction({
      stuck: true,
      level: "warning",
      detector: "known_poll_no_progress",
      count: 10,
      message: "warning",
    });
    const pingPongDecision = decideLoopPolicyAction({
      stuck: true,
      level: "warning",
      detector: "ping_pong",
      count: 10,
      message: "warning",
    });

    expect(knownPollDecision).toEqual({
      blocked: false,
      action: "nudge",
    });
    expect(pingPongDecision).toEqual({
      blocked: false,
      action: "nudge",
    });
  });

  it("soft-blocks exact repeats at critical thresholds", () => {
    const decision = decideLoopPolicyAction({
      stuck: true,
      level: "critical",
      detector: "known_poll_no_progress",
      count: 20,
      message: "CRITICAL: stuck polling loop",
    });

    expect(decision).toMatchObject({
      blocked: true,
      action: "soft_block_exact_repeat",
    });
    expect(decision?.blocked && decision.reason).toContain("Exact repeat blocked by loop policy");
  });

  it("requires a plan refresh for critical ping-pong loops", () => {
    const decision = decideLoopPolicyAction({
      stuck: true,
      level: "critical",
      detector: "ping_pong",
      count: 20,
      message: "CRITICAL: ping-pong loop",
    });

    expect(decision).toMatchObject({
      blocked: true,
      action: "require_plan_refresh",
    });
    expect(decision?.blocked && decision.reason).toContain("Plan refresh required");
  });
});
