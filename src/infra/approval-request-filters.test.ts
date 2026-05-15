import { describe, expect, it } from "vitest";
import {
  matchesApprovalRequestFilters,
  matchesApprovalRequestSessionFilter,
} from "./approval-request-filters.js";

describe("approval request filters", () => {
  it("matches explicit agent ids and session substrings", () => {
    expect(
      matchesApprovalRequestFilters({
        request: {
          agentId: "ops-agent",
          sessionKey: "agent:ops-agent:ddingtalk:direct:U1:tail",
        },
        agentFilter: ["ops-agent"],
        sessionFilter: ["ddingtalk:direct:", "tail$"],
      }),
    ).toBe(true);
  });

  it("can fall back to the session-key agent id", () => {
    expect(
      matchesApprovalRequestFilters({
        request: {
          sessionKey: "agent:ops-agent:feishu:group:-1001",
        },
        agentFilter: ["ops-agent"],
        fallbackAgentIdFromSessionKey: true,
      }),
    ).toBe(true);
    expect(
      matchesApprovalRequestFilters({
        request: {
          sessionKey: "agent:ops-agent:feishu:group:-1001",
        },
        agentFilter: ["ops-agent"],
      }),
    ).toBe(false);
  });

  it("rejects unsafe regex patterns in session filters", () => {
    expect(matchesApprovalRequestSessionFilter(`${"a".repeat(28)}!`, ["(a+)+$"])).toBe(false);
  });
});
