import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleReviewCommand } from "./commands-review.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

const { executeMock, createReviewTaskToolMock } = vi.hoisted(() => {
  const executeMock =
    vi.fn<
      (toolCallId: string, args: Record<string, unknown>) => Promise<AgentToolResult<unknown>>
    >();
  const createReviewTaskToolMock = vi.fn(() => ({
    execute: executeMock,
  }));
  return {
    executeMock,
    createReviewTaskToolMock,
  };
});

vi.mock("../../agents/tools/review-task-tool.js", () => ({
  createReviewTaskTool: createReviewTaskToolMock,
}));

describe("handleReviewCommand", () => {
  beforeEach(() => {
    executeMock.mockReset();
    createReviewTaskToolMock.mockClear();
  });

  it("uses the default review task when no args are provided", async () => {
    executeMock.mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
      details: {
        status: "completed",
        verdict: "REVIEW_PASS",
        summary: "Both review stages passed.",
        childRuns: [{ childSessionKey: "agent:main:subagent:review-quality-child" }],
      },
    });

    const params = buildCommandTestParams("/review", {});
    const result = await handleReviewCommand(params, true);

    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("Review PASS");
    expect(result?.reply?.text).toContain("Both review stages passed.");
    expect(result?.reply?.text).toContain("review-quality-child");
    expect(executeMock).toHaveBeenCalledWith(
      "command:/review",
      expect.objectContaining({
        task: expect.stringContaining("Review the current task outcome"),
      }),
    );
  });

  it("passes explicit review focus through to the tool", async () => {
    executeMock.mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
      details: {
        status: "completed",
        verdict: "REVIEW_FAIL",
        summary: "Plugin SDK boundary is still violated.",
      },
    });

    const params = buildCommandTestParams("/review focus on plugin SDK boundaries", {});
    const result = await handleReviewCommand(params, true);

    expect(result?.reply?.text).toContain("Review FAIL");
    expect(executeMock).toHaveBeenCalledWith("command:/review", {
      task: expect.stringContaining("Review the current task outcome"),
      reviewFocus: ["focus on plugin SDK boundaries"],
    });
  });

  it("rejects nested review sessions", async () => {
    const params = buildCommandTestParams("/review", {});
    params.sessionEntry = {
      sessionId: "child",
      updatedAt: Date.now(),
      spawnSource: "review-spec",
    };

    const result = await handleReviewCommand(params, true);

    expect(result).toEqual({
      shouldContinue: false,
      reply: { text: "Review sessions cannot start nested review runs." },
    });
    expect(executeMock).not.toHaveBeenCalled();
  });
});
