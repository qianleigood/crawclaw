import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitAgentActionEvent } from "../action-feed/emit.js";
import { __testing as verifyTaskToolTesting, createVerifyTaskTool } from "./verify-task-tool.js";

vi.mock("../action-feed/emit.js", () => ({
  emitAgentActionEvent: vi.fn(),
}));

describe("createVerifyTaskTool", () => {
  const spawnAgentSessionDirect = vi.fn();
  const captureSubagentCompletionReply = vi.fn();
  const callGateway = vi.fn();
  const emitAgentActionEventMock = vi.mocked(emitAgentActionEvent);

  beforeEach(() => {
    spawnAgentSessionDirect.mockReset();
    captureSubagentCompletionReply.mockReset();
    callGateway.mockReset();
    emitAgentActionEventMock.mockReset();
    verifyTaskToolTesting.setDepsForTest({
      spawnAgentSessionDirect: spawnAgentSessionDirect as never,
      captureSubagentCompletionReply: captureSubagentCompletionReply as never,
      callGateway: callGateway as never,
    });
  });

  it("spawns a verification-only subagent and returns its parsed verdict", async () => {
    spawnAgentSessionDirect.mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:main:subagent:verify-1",
      runId: "run-verify-1",
      mode: "run",
    });
    callGateway.mockResolvedValue({
      status: "ok",
      endedAt: 1234,
    });
    captureSubagentCompletionReply.mockResolvedValue(
      [
        "VERDICT: PASS",
        "SUMMARY: Verified the fix with targeted checks.",
        "CHECKS:",
        "- PASS: pnpm test --filter worker",
        "- WARN: Did not rerun the ARM-only scenario.",
        "FAILING_COMMANDS:",
        "- none",
        "WARNINGS:",
        "- ARM-only coverage remains manual.",
        "ARTIFACTS:",
        "- logs/worker-verification.txt",
      ].join("\n"),
    );

    const tool = createVerifyTaskTool({
      agentSessionKey: "agent:main:main",
      workspaceDir: "/tmp/workspace-main",
    });
    const result = await tool.execute("call-verify-1", {
      task: "Fix the worker crash on empty payload",
      approach: "Guard empty payloads before dispatch.",
      changedFiles: ["src/worker.ts"],
      validationFocus: ["Reproduce the empty-payload path", "Confirm the crash is gone"],
      runTimeoutSeconds: 45,
    });

    expect(spawnAgentSessionDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "subagent",
        label: "verification",
        cleanup: "keep",
        expectsCompletionMessage: false,
        spawnSource: "verification",
        extraSystemPrompt: expect.stringContaining("Verification Agent"),
      }),
      expect.objectContaining({
        agentSessionKey: "agent:main:main",
        workspaceDir: "/tmp/workspace-main",
      }),
    );
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "agent.wait",
        params: expect.objectContaining({
          runId: "run-verify-1",
        }),
      }),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "completed",
        verdict: "PASS",
        summary: "Verified the fix with targeted checks.",
        checks: [
          {
            status: "PASS",
            summary: "pnpm test --filter worker",
          },
          {
            status: "WARN",
            summary: "Did not rerun the ARM-only scenario.",
          },
        ],
        failingCommands: [],
        warnings: ["ARM-only coverage remains manual."],
        artifacts: ["logs/worker-verification.txt"],
        childSessionKey: "agent:main:subagent:verify-1",
        runId: "run-verify-1",
        spawnSource: "verification",
      }),
    );
    expect(emitAgentActionEventMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        runId: "verification:call-verify-1",
        sessionKey: "agent:main:main",
        data: expect.objectContaining({
          actionId: "verification:call-verify-1",
          kind: "verification",
          status: "started",
          title: "Verification started",
        }),
      }),
    );
    expect(emitAgentActionEventMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        runId: "verification:call-verify-1",
        sessionKey: "agent:main:main",
        data: expect.objectContaining({
          actionId: "verification:call-verify-1",
          kind: "verification",
          status: "running",
          title: "Verification running",
        }),
      }),
    );
    expect(emitAgentActionEventMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        runId: "verification:call-verify-1",
        sessionKey: "agent:main:main",
        data: expect.objectContaining({
          actionId: "verification:call-verify-1",
          kind: "verification",
          status: "completed",
          title: "Verification PASS",
          detail: expect.objectContaining({
            verdict: "PASS",
            checks: [
              {
                status: "PASS",
                summary: "pnpm test --filter worker",
              },
              {
                status: "WARN",
                summary: "Did not rerun the ARM-only scenario.",
              },
            ],
            warnings: ["ARM-only coverage remains manual."],
            artifacts: ["logs/worker-verification.txt"],
            checkCounts: {
              pass: 1,
              fail: 0,
              warn: 1,
            },
          }),
        }),
      }),
    );
  });

  it("fails fast when the verification agent omits a verdict line", async () => {
    spawnAgentSessionDirect.mockResolvedValue({
      status: "accepted",
      childSessionKey: "agent:main:subagent:verify-2",
      runId: "run-verify-2",
      mode: "run",
    });
    callGateway.mockResolvedValue({ status: "ok", endedAt: 55 });
    captureSubagentCompletionReply.mockResolvedValue("SUMMARY: Checked a few things.");

    const tool = createVerifyTaskTool();
    await expect(
      tool.execute("call-verify-2", {
        task: "Verify the fix",
      }),
    ).rejects.toThrow(/without a VERDICT/i);
    expect(emitAgentActionEventMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        runId: "verification:call-verify-2",
        data: expect.objectContaining({
          kind: "verification",
          status: "started",
        }),
      }),
    );
    expect(emitAgentActionEventMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        runId: "verification:call-verify-2",
        data: expect.objectContaining({
          kind: "verification",
          status: "running",
        }),
      }),
    );
    expect(emitAgentActionEventMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        runId: "verification:call-verify-2",
        data: expect.objectContaining({
          kind: "verification",
          status: "failed",
          title: "Verification report invalid",
        }),
      }),
    );
  });
});
