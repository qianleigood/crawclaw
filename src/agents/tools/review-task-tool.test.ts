import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitAgentActionEvent } from "../action-feed/emit.js";
import { __testing as reviewTaskToolTesting, createReviewTaskTool } from "./review-task-tool.js";

vi.mock("../action-feed/emit.js", () => ({
  emitAgentActionEvent: vi.fn(),
}));

describe("createReviewTaskTool", () => {
  const spawnAgentSessionDirect = vi.fn();
  const captureSubagentCompletionReply = vi.fn();
  const callGateway = vi.fn();
  const emitAgentActionEventMock = vi.mocked(emitAgentActionEvent);

  beforeEach(() => {
    spawnAgentSessionDirect.mockReset();
    captureSubagentCompletionReply.mockReset();
    callGateway.mockReset();
    emitAgentActionEventMock.mockReset();
    reviewTaskToolTesting.setDepsForTest({
      spawnAgentSessionDirect: spawnAgentSessionDirect as never,
      captureSubagentCompletionReply: captureSubagentCompletionReply as never,
      callGateway: callGateway as never,
    });
  });

  it("runs spec then quality review and returns an aggregated pass", async () => {
    spawnAgentSessionDirect
      .mockResolvedValueOnce({
        status: "accepted",
        childSessionKey: "agent:main:subagent:review-spec-1",
        runId: "run-review-spec-1",
        mode: "run",
      })
      .mockResolvedValueOnce({
        status: "accepted",
        childSessionKey: "agent:main:subagent:review-quality-1",
        runId: "run-review-quality-1",
        mode: "run",
      });
    callGateway.mockResolvedValue({ status: "ok", endedAt: 1234 });
    captureSubagentCompletionReply
      .mockResolvedValueOnce(
        [
          "STAGE: SPEC",
          "VERDICT: PASS",
          "SUMMARY: The implementation satisfies the requested review command.",
          "BLOCKING_ISSUES:",
          "- none",
          "WARNINGS:",
          "- none",
          "EVIDENCE:",
          "- inspected src/auto-reply/commands-registry.shared.ts",
          "RECOMMENDED_FIXES:",
          "- none",
        ].join("\n"),
      )
      .mockResolvedValueOnce(
        [
          "STAGE: QUALITY",
          "VERDICT: PASS",
          "SUMMARY: The implementation is maintainable and covered.",
          "BLOCKING_ISSUES:",
          "- none",
          "WARNINGS:",
          "- none",
          "EVIDENCE:",
          "- pnpm test -- src/agents/tools/review-task-tool.test.ts",
          "RECOMMENDED_FIXES:",
          "- none",
        ].join("\n"),
      );

    const tool = createReviewTaskTool({
      agentSessionKey: "agent:main:main",
      workspaceDir: "/tmp/workspace-main",
    });
    const result = await tool.execute("call-review-1", {
      task: "Replace verification with two-stage review",
      approach: "Added /review and review_task.",
      changedFiles: ["src/agents/review-agent.ts"],
      reviewFocus: ["Ensure /verify is removed"],
      runTimeoutSeconds: 45,
    });

    expect(spawnAgentSessionDirect).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        runtime: "subagent",
        label: "review spec",
        cleanup: "keep",
        expectsCompletionMessage: false,
        spawnSource: "review-spec",
        extraSystemPrompt: expect.stringContaining("Spec Compliance Review"),
      }),
      expect.objectContaining({
        agentSessionKey: "agent:main:main",
        workspaceDir: "/tmp/workspace-main",
      }),
    );
    expect(spawnAgentSessionDirect).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        label: "review quality",
        spawnSource: "review-quality",
        extraSystemPrompt: expect.stringContaining("Code Quality Review"),
      }),
      expect.anything(),
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "completed",
        verdict: "REVIEW_PASS",
        summary: expect.stringContaining("requested review command"),
        blockingIssues: [],
        warnings: [],
        evidence: [
          "inspected src/auto-reply/commands-registry.shared.ts",
          "pnpm test -- src/agents/tools/review-task-tool.test.ts",
        ],
        skippedStages: [],
        childRuns: [
          expect.objectContaining({
            stage: "spec",
            childSessionKey: "agent:main:subagent:review-spec-1",
            runId: "run-review-spec-1",
          }),
          expect.objectContaining({
            stage: "quality",
            childSessionKey: "agent:main:subagent:review-quality-1",
            runId: "run-review-quality-1",
          }),
        ],
        spawnSource: "review",
      }),
    );
    expect(emitAgentActionEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "review:call-review-1",
        data: expect.objectContaining({
          actionId: "review:call-review-1",
          kind: "review",
          status: "completed",
          title: "Review PASS",
        }),
      }),
    );
  });

  it("short-circuits quality review when the spec stage fails", async () => {
    spawnAgentSessionDirect.mockResolvedValueOnce({
      status: "accepted",
      childSessionKey: "agent:main:subagent:review-spec-2",
      runId: "run-review-spec-2",
      mode: "run",
    });
    callGateway.mockResolvedValue({ status: "ok", endedAt: 55 });
    captureSubagentCompletionReply.mockResolvedValueOnce(
      [
        "STAGE: SPEC",
        "VERDICT: FAIL",
        "SUMMARY: The review command was not registered.",
        "BLOCKING_ISSUES:",
        "- Missing /review command registration.",
        "WARNINGS:",
        "- none",
        "EVIDENCE:",
        "- read src/auto-reply/commands-registry.shared.ts",
        "RECOMMENDED_FIXES:",
        "- Register /review.",
      ].join("\n"),
    );

    const tool = createReviewTaskTool();
    const result = await tool.execute("call-review-2", {
      task: "Replace verification with review",
    });

    expect(spawnAgentSessionDirect).toHaveBeenCalledTimes(1);
    expect(result.details).toEqual(
      expect.objectContaining({
        status: "completed",
        verdict: "REVIEW_FAIL",
        skippedStages: ["quality"],
        blockingIssues: ["Missing /review command registration."],
      }),
    );
  });
});
