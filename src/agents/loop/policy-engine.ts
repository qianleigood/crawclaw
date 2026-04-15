import type { LoopDetectionResult } from "../tool-loop-detection.js";

export type LoopPolicyAction =
  | "warn"
  | "nudge"
  | "soft_block_exact_repeat"
  | "require_plan_refresh";

export type LoopPolicyDecision =
  | {
      blocked: false;
      action: "warn" | "nudge";
    }
  | {
      blocked: true;
      action: "soft_block_exact_repeat" | "require_plan_refresh";
      reason: string;
    };

function buildBlockedReason(result: Extract<LoopDetectionResult, { stuck: true }>): string {
  if (result.detector === "ping_pong") {
    return `${result.message} Plan refresh required: stop alternating between the same tool-call patterns and revise your next step before trying again.`;
  }
  return `${result.message} Exact repeat blocked by loop policy: change parameters, wait longer, or switch tools before retrying.`;
}

export function decideLoopPolicyAction(
  result: LoopDetectionResult,
): LoopPolicyDecision | undefined {
  if (!result.stuck) {
    return undefined;
  }

  if (result.level === "warning") {
    if (result.detector === "ping_pong" || result.detector === "known_poll_no_progress") {
      return {
        blocked: false,
        action: "nudge",
      };
    }
    return {
      blocked: false,
      action: "warn",
    };
  }

  if (result.detector === "ping_pong") {
    return {
      blocked: true,
      action: "require_plan_refresh",
      reason: buildBlockedReason(result),
    };
  }

  return {
    blocked: true,
    action: "soft_block_exact_repeat",
    reason: buildBlockedReason(result),
  };
}
