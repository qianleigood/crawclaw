import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleVerifyCommand } from "./commands-verify.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

const { executeMock, createVerifyTaskToolMock } = vi.hoisted(() => {
  const executeMock =
    vi.fn<
      (toolCallId: string, args: Record<string, unknown>) => Promise<AgentToolResult<unknown>>
    >();
  const createVerifyTaskToolMock = vi.fn(() => ({
    execute: executeMock,
  }));
  return {
    executeMock,
    createVerifyTaskToolMock,
  };
});

vi.mock("../../agents/tools/verify-task-tool.js", () => ({
  createVerifyTaskTool: createVerifyTaskToolMock,
}));

describe("handleVerifyCommand", () => {
  beforeEach(() => {
    executeMock.mockReset();
    createVerifyTaskToolMock.mockClear();
  });

  it("uses the default verification task when no args are provided", async () => {
    executeMock.mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
      details: {
        status: "completed",
        verdict: "PASS",
        summary: "All checks passed.",
        childSessionKey: "agent:main:subagent:verification-child",
      },
    });

    const params = buildCommandTestParams("/verify", {});
    const result = await handleVerifyCommand(params, true);

    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("Verification PASS");
    expect(result?.reply?.text).toContain("All checks passed.");
    expect(result?.reply?.text).toContain("verification-child");
    expect(executeMock).toHaveBeenCalledWith(
      "command:/verify",
      expect.objectContaining({
        task: expect.stringContaining("Verify the current task outcome"),
      }),
    );
  });

  it("passes explicit verification text through to the tool", async () => {
    executeMock.mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
      details: {
        status: "completed",
        verdict: "FAIL",
        summary: "Regression still reproducible.",
      },
    });

    const params = buildCommandTestParams(
      "/verify reproduce login twice then confirm retry flow",
      {},
    );
    const result = await handleVerifyCommand(params, true);

    expect(result?.reply?.text).toContain("Verification FAIL");
    expect(executeMock).toHaveBeenCalledWith("command:/verify", {
      task: "reproduce login twice then confirm retry flow",
    });
  });

  it("rejects nested verification sessions", async () => {
    const params = buildCommandTestParams("/verify", {});
    params.sessionEntry = {
      sessionId: "child",
      updatedAt: Date.now(),
      spawnSource: "verification",
    };

    const result = await handleVerifyCommand(params, true);

    expect(result).toEqual({
      shouldContinue: false,
      reply: { text: "⚠️ Verification sessions cannot start nested verification runs." },
    });
    expect(executeMock).not.toHaveBeenCalled();
  });
});
