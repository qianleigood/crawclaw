import { beforeEach, describe, expect, it, vi } from "vitest";
import { __testing as reviewTaskToolTesting, createReviewTaskTool } from "./review-task-tool.js";

describe("createReviewTaskTool", () => {
  const spawnAgentSessionDirect = vi.fn();
  const captureSubagentCompletionReply = vi.fn();
  const callGateway = vi.fn();
  const emitAgentActionEventMock = vi.fn();

  beforeEach(() => {
    spawnAgentSessionDirect.mockReset();
    captureSubagentCompletionReply.mockReset();
    callGateway.mockReset();
    emitAgentActionEventMock.mockReset();
    reviewTaskToolTesting.setDepsForTest({
      spawnAgentSessionDirect: spawnAgentSessionDirect as never,
      captureSubagentCompletionReply: captureSubagentCompletionReply as never,
      callGateway: callGateway as never,
      emitAgentActionEvent: emitAgentActionEventMock as never,
    });
  });

  it("runs spec then quality and returns REVIEW_PASS", async () => {
    spawnAgentSessionDirect
      .mockResolvedValueOnce({
        status: "accepted",
        childSessionKey: "agent:main:subagent:review-spec",
        runId: "run-review-spec",
        mode: "run",
      })
      .mockResolvedValueOnce({
        status: "accepted",
        childSessionKey: "agent:main:subagent:review-quality",
        runId: "run-review-quality",
        mode: "run",
      });
    callGateway.mockResolvedValue({ status: "ok", endedAt: 1234 });
    captureSubagentCompletionReply
      .mockResolvedValueOnce(
        [
          "STAGE: SPEC",
          "VERDICT: PASS",
          "SUMMARY: Requirements are covered.",
          "BLOCKING_ISSUES:",
          "- none",
          "WARNINGS:",
          "- none",
          "EVIDENCE:",
          "- inspected changed files",
          "RECOMMENDED_FIXES:",
          "- none",
        ].join("\n"),
      )
      .mockResolvedValueOnce(
        [
          "STAGE: QUALITY",
          "VERDICT: PASS",
          "SUMMARY: Implementation is shippable.",
          "BLOCKING_ISSUES:",
          "- none",
          "WARNINGS:",
          "- none",
          "EVIDENCE:",
          "- ran pnpm test -- src/agents/review-agent.test.ts",
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
      approach: "Add review-spec and review-quality agents.",
      changedFiles: ["src/agents/review-agent.ts"],
      reviewFocus: ["plugin SDK boundary"],
      runTimeoutSeconds: 45,
    });

    expect(spawnAgentSessionDirect).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        runtime: "subagent",
        label: "review spec",
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
        runtime: "subagent",
        label: "review quality",
        spawnSource: "review-quality",
        extraSystemPrompt: expect.stringContaining("Code Quality Review"),
      }),
      expect.anything(),
    );
    expect(result.details).toMatchObject({
      status: "completed",
      verdict: "REVIEW_PASS",
      spec: { verdict: "PASS" },
      quality: { verdict: "PASS" },
      skippedStages: [],
      childRuns: [
        expect.objectContaining({ stage: "spec", runId: "run-review-spec" }),
        expect.objectContaining({ stage: "quality", runId: "run-review-quality" }),
      ],
      spawnSource: "review",
    });
    expect(emitAgentActionEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "review:call-review-1",
        data: expect.objectContaining({
          kind: "review",
          status: "completed",
          title: "Review PASS",
        }),
      }),
    );
  });

  it("short-circuits quality when spec fails", async () => {
    spawnAgentSessionDirect.mockResolvedValueOnce({
      status: "accepted",
      childSessionKey: "agent:main:subagent:review-spec",
      runId: "run-review-spec",
      mode: "run",
    });
    callGateway.mockResolvedValue({ status: "ok", endedAt: 55 });
    captureSubagentCompletionReply.mockResolvedValueOnce(
      [
        "STAGE: SPEC",
        "VERDICT: FAIL",
        "SUMMARY: User requirement was not implemented.",
        "BLOCKING_ISSUES:",
        "- Missing /review command.",
        "WARNINGS:",
        "- none",
        "EVIDENCE:",
        "- inspected command registry",
        "RECOMMENDED_FIXES:",
        "- Add /review.",
      ].join("\n"),
    );

    const tool = createReviewTaskTool();
    const result = await tool.execute("call-review-2", {
      task: "Replace the legacy verifier entrypoint with /review",
    });

    expect(spawnAgentSessionDirect).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({
      status: "completed",
      verdict: "REVIEW_FAIL",
      spec: { verdict: "FAIL" },
      skippedStages: ["quality"],
      blockingIssues: ["Missing /review command."],
    });
  });

  it("does not pass malformed stage output", async () => {
    spawnAgentSessionDirect
      .mockResolvedValueOnce({
        status: "accepted",
        childSessionKey: "agent:main:subagent:review-spec",
        runId: "run-review-spec",
        mode: "run",
      })
      .mockResolvedValueOnce({
        status: "accepted",
        childSessionKey: "agent:main:subagent:review-quality",
        runId: "run-review-quality",
        mode: "run",
      });
    callGateway.mockResolvedValue({ status: "ok", endedAt: 55 });
    captureSubagentCompletionReply
      .mockResolvedValueOnce("SUMMARY: no strict report")
      .mockResolvedValueOnce(
        [
          "STAGE: QUALITY",
          "VERDICT: PASS",
          "SUMMARY: Code quality looks good.",
          "BLOCKING_ISSUES:",
          "- none",
          "WARNINGS:",
          "- none",
          "EVIDENCE:",
          "- inspected changed files",
          "RECOMMENDED_FIXES:",
          "- none",
        ].join("\n"),
      );

    const tool = createReviewTaskTool();
    const result = await tool.execute("call-review-3", {
      task: "Review malformed spec report behavior",
    });

    expect(result.details).toMatchObject({
      status: "completed",
      verdict: "REVIEW_PARTIAL",
      spec: { verdict: "PARTIAL", valid: false },
    });
  });
});
