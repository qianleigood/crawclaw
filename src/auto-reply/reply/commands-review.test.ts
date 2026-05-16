import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleReviewCommand } from "./commands-review.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

const { callGatewayMock } = vi.hoisted(() => {
  const callGatewayMock = vi.fn();
  return {
    callGatewayMock,
  };
});

vi.mock("../../gateway/call.js", () => ({
  callGateway: callGatewayMock,
}));

describe("handleReviewCommand", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
  });

  it("uses the default review task when no args are provided", async () => {
    callGatewayMock.mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
      details: {
        status: "completed",
        verdict: "REVIEW_PASS",
        summary: "Review found enough evidence.",
        spec: { verdict: "PASS" },
        quality: { verdict: "PASS" },
        childRuns: [{ childSessionKey: "agent:main:subagent:review-spec" }],
      },
    });

    const params = buildCommandTestParams("/review", {});
    const result = await handleReviewCommand(params, true);

    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("Review PASS");
    expect(result?.reply?.text).toContain("Spec Compliance: PASS");
    expect(result?.reply?.text).toContain("Code Quality: PASS");
    expect(result?.reply?.text).toContain("review-spec");
    expect(callGatewayMock).toHaveBeenCalledWith({
      method: "tools.invoke",
      params: {
        tool: "review_task",
        input: expect.objectContaining({
          sessionKey: params.sessionKey,
          task: expect.stringContaining("Review the current task outcome"),
        }),
      },
    });
  });

  it("passes explicit review focus through to the tool", async () => {
    callGatewayMock.mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
      details: {
        status: "completed",
        verdict: "REVIEW_FAIL",
        summary: "Plugin SDK boundary was bypassed.",
        spec: { verdict: "PASS" },
        quality: { verdict: "FAIL" },
        blockingIssues: ["src/plugins/foo.ts imports src/plugin-sdk-internal/bar.ts"],
      },
    });

    const params = buildCommandTestParams("/review 重点看 plugin SDK 边界有没有被破坏", {});
    const result = await handleReviewCommand(params, true);

    expect(result?.reply?.text).toContain("Review FAIL");
    expect(result?.reply?.text).toContain("Plugin SDK boundary was bypassed.");
    expect(result?.reply?.text).toContain("Blocking issues:");
    expect(callGatewayMock).toHaveBeenCalledWith({
      method: "tools.invoke",
      params: {
        tool: "review_task",
        input: expect.objectContaining({
          sessionKey: params.sessionKey,
          task: expect.stringContaining("Review focus:\n- 重点看 plugin SDK 边界有没有被破坏"),
        }),
      },
    });
  });

  it("rejects nested review sessions", async () => {
    const params = buildCommandTestParams("/review", {});
    params.sessionEntry = {
      sessionId: "child",
      updatedAt: Date.now(),
      spawnSource: "review-quality",
    };

    const result = await handleReviewCommand(params, true);

    expect(result).toEqual({
      shouldContinue: false,
      reply: { text: "⚠️ Review sessions cannot start nested review runs." },
    });
    expect(callGatewayMock).not.toHaveBeenCalled();
  });
});
