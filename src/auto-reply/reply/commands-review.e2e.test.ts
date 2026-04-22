import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing as reviewTaskToolTesting } from "../../agents/tools/review-task-tool.js";
import { handleReviewCommand } from "./commands-review.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

function buildStageReport(params: {
  stage: "SPEC" | "QUALITY";
  verdict: "PASS" | "FAIL" | "PARTIAL";
  summary: string;
  evidence: string;
}) {
  return [
    `STAGE: ${params.stage}`,
    `VERDICT: ${params.verdict}`,
    `SUMMARY: ${params.summary}`,
    "BLOCKING_ISSUES:",
    "- none",
    "WARNINGS:",
    "- none",
    "EVIDENCE:",
    `- ${params.evidence}`,
    "RECOMMENDED_FIXES:",
    "- none",
  ].join("\n");
}

describe("review command two-stage pipeline e2e", () => {
  const spawnAgentSessionDirect = vi.fn();
  const captureSubagentCompletionReply = vi.fn();
  const callGateway = vi.fn();
  const emitAgentActionEvent = vi.fn();

  beforeEach(() => {
    spawnAgentSessionDirect.mockReset();
    captureSubagentCompletionReply.mockReset();
    callGateway.mockReset();
    emitAgentActionEvent.mockReset();
    reviewTaskToolTesting.setDepsForTest({
      spawnAgentSessionDirect: spawnAgentSessionDirect as never,
      captureSubagentCompletionReply: captureSubagentCompletionReply as never,
      callGateway: callGateway as never,
      emitAgentActionEvent: emitAgentActionEvent as never,
    });
  });

  afterEach(() => {
    reviewTaskToolTesting.setDepsForTest();
  });

  it("runs /review through spec and quality agents before returning the aggregate result", async () => {
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
    callGateway.mockResolvedValue({ status: "ok", endedAt: 123 });
    captureSubagentCompletionReply
      .mockResolvedValueOnce(
        buildStageReport({
          stage: "SPEC",
          verdict: "PASS",
          summary: "Requested behavior is covered.",
          evidence: "inspected changed files",
        }),
      )
      .mockResolvedValueOnce(
        buildStageReport({
          stage: "QUALITY",
          verdict: "PASS",
          summary: "Implementation quality is shippable.",
          evidence: "ran targeted review tests",
        }),
      );

    const result = await handleReviewCommand(
      buildCommandTestParams(
        "/review 重点看 plugin SDK 边界有没有被破坏",
        {},
        { AccountId: "acct-1", To: "room-1", MessageThreadId: "thread-1" },
        { workspaceDir: "/workspace/crawclaw" },
      ),
      true,
    );

    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("Review PASS");
    expect(result?.reply?.text).toContain("Spec Compliance: PASS");
    expect(result?.reply?.text).toContain("Code Quality: PASS");
    expect(result?.reply?.text).toContain("Requested behavior is covered.");
    expect(result?.reply?.text).toContain("inspected changed files");
    expect(result?.reply?.text).toContain("ran targeted review tests");
    expect(result?.reply?.text).toContain("agent:main:subagent:review-spec");
    expect(result?.reply?.text).toContain("agent:main:subagent:review-quality");

    expect(spawnAgentSessionDirect).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        label: "review spec",
        spawnSource: "review-spec",
        extraSystemPrompt: expect.stringContaining("Spec Compliance Review"),
        task: expect.stringContaining("## Review Focus\n- 重点看 plugin SDK 边界有没有被破坏"),
      }),
      expect.objectContaining({
        agentSessionKey: "agent:main:main",
        agentAccountId: "acct-1",
        agentTo: "room-1",
        agentThreadId: "thread-1",
        workspaceDir: "/workspace/crawclaw",
      }),
    );
    expect(spawnAgentSessionDirect).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        label: "review quality",
        spawnSource: "review-quality",
        extraSystemPrompt: expect.stringContaining("Code Quality Review"),
        task: expect.stringContaining("## Spec Compliance Review Result"),
      }),
      expect.anything(),
    );
    expect(captureSubagentCompletionReply).toHaveBeenNthCalledWith(
      1,
      "agent:main:subagent:review-spec",
    );
    expect(captureSubagentCompletionReply).toHaveBeenNthCalledWith(
      2,
      "agent:main:subagent:review-quality",
    );
    expect(emitAgentActionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "review:command:/review",
        data: expect.objectContaining({
          kind: "review",
          status: "completed",
          title: "Review PASS",
          detail: expect.objectContaining({
            verdict: "REVIEW_PASS",
            childRuns: [
              expect.objectContaining({ stage: "spec", spawnSource: "review-spec" }),
              expect.objectContaining({ stage: "quality", spawnSource: "review-quality" }),
            ],
          }),
        }),
      }),
    );
  });
});
