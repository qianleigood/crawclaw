import { describe, expect, it } from "vitest";
import { evaluateCompletionGuard } from "./completion-guard.js";

describe("completion-guard", () => {
  it("accepts fix tasks when change and validation evidence are present", () => {
    const result = evaluateCompletionGuard({
      task: {
        label: "Fix worker regression",
        task: "Investigate and patch the broken worker flow",
      },
      trajectory: {
        status: "completed",
        evidence: [
          {
            kind: "file_changed",
            at: 10,
            summary: "Modified /tmp/worker.ts",
            path: "/tmp/worker.ts",
            source: "tool",
          },
          {
            kind: "test_passed",
            at: 11,
            summary: "Command passed: pnpm test --filter worker",
            command: "pnpm test --filter worker",
            source: "tool",
          },
          {
            kind: "answer_provided",
            at: 12,
            summary: "Patched the worker flow and verified the fix.",
            source: "assistant",
          },
        ],
      },
      evaluatedAt: 12,
    });

    expect(result).toMatchObject({
      status: "accepted",
      spec: {
        taskType: "fix",
      },
      missingEvidence: [],
    });
  });

  it("marks fix tasks incomplete when no validation evidence is present", () => {
    const result = evaluateCompletionGuard({
      task: {
        task: "Patch the broken worker flow",
      },
      trajectory: {
        status: "completed",
        evidence: [
          {
            kind: "file_changed",
            at: 10,
            summary: "Modified /tmp/worker.ts",
            path: "/tmp/worker.ts",
            source: "tool",
          },
        ],
      },
      evaluatedAt: 10,
    });

    expect(result).toMatchObject({
      status: "incomplete",
      spec: {
        taskType: "fix",
      },
      missingEvidence: [],
      missingAnyOfEvidence: ["test_passed", "assertion_met", "review_passed"],
      blockingState: "review_missing",
    });
  });

  it("accepts fix tasks when a two-stage review passed", () => {
    const result = evaluateCompletionGuard({
      task: {
        task: "Patch the broken worker flow",
      },
      trajectory: {
        status: "completed",
        evidence: [
          {
            kind: "file_changed",
            at: 10,
            summary: "Modified /tmp/worker.ts",
            path: "/tmp/worker.ts",
            source: "tool",
          },
          {
            kind: "review_passed",
            at: 11,
            summary: "Review passed: spec and quality stages passed.",
            source: "tool",
          },
        ],
      },
      evaluatedAt: 11,
    });

    expect(result).toMatchObject({
      status: "accepted_with_warnings",
      spec: {
        taskType: "fix",
      },
      missingEvidence: [],
    });
  });

  it("accepts code tasks with warnings when the final answer is missing", () => {
    const result = evaluateCompletionGuard({
      task: {
        task: "Refactor the worker file",
      },
      trajectory: {
        status: "completed",
        evidence: [
          {
            kind: "file_changed",
            at: 10,
            summary: "Modified /tmp/worker.ts",
            path: "/tmp/worker.ts",
            source: "tool",
          },
        ],
      },
      evaluatedAt: 10,
    });

    expect(result).toMatchObject({
      status: "accepted_with_warnings",
      spec: {
        taskType: "code",
      },
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining(["Missing recommended evidence: final answer."]),
    );
  });

  it("does not let label-only fix wording override an answer-style task", () => {
    const result = evaluateCompletionGuard({
      task: {
        label: "live-subagent-fix-test",
        task: "Reply with exactly SUBAGENT_LIVE_FIX_OK and then stop.",
      },
      trajectory: {
        status: "completed",
        evidence: [
          {
            kind: "answer_provided",
            at: 10,
            summary: "SUBAGENT_LIVE_FIX_OK",
            source: "assistant",
          },
        ],
      },
      evaluatedAt: 10,
    });

    expect(result).toMatchObject({
      status: "accepted",
      spec: {
        taskType: "answer",
      },
    });
  });

  it("marks confirmation tasks as waiting_user until the user confirms", () => {
    const result = evaluateCompletionGuard({
      task: {
        task: "Ask the user to review the rollout plan and confirm whether to proceed.",
      },
      trajectory: {
        status: "completed",
        evidence: [
          {
            kind: "answer_provided",
            at: 10,
            summary: "Proposed the rollout plan and asked for confirmation.",
            source: "assistant",
          },
        ],
      },
      evaluatedAt: 10,
    });

    expect(result).toMatchObject({
      status: "waiting_user",
      blockingState: "waiting_user",
      spec: {
        taskType: "workflow",
        completionMode: "needs_user_confirmation",
      },
    });
  });

  it("marks polling tasks as waiting_external until the external state changes", () => {
    const result = evaluateCompletionGuard({
      task: {
        task: "Wait until the remote deployment is healthy, then report back.",
      },
      trajectory: {
        status: "completed",
        evidence: [
          {
            kind: "answer_provided",
            at: 10,
            summary: "Checked the deployment once and stopped.",
            source: "assistant",
          },
        ],
      },
      evaluatedAt: 10,
    });

    expect(result).toMatchObject({
      status: "waiting_external",
      blockingState: "waiting_external",
      spec: {
        taskType: "poll",
        completionMode: "external_condition",
      },
    });
  });

  it("accepts workflow tasks when related child evidence provides the completion signal", () => {
    const result = evaluateCompletionGuard({
      task: {
        task: "Coordinate the worker workflow with a subagent and report the result.",
      },
      trajectory: {
        status: "completed",
        evidence: [],
      },
      relatedEvidence: [
        {
          kind: "answer_provided",
          at: 11,
          summary: "Child agent reported WORKFLOW_OK.",
          source: "assistant",
        },
      ],
      evaluatedAt: 12,
    });

    expect(result).toMatchObject({
      status: "accepted",
      relatedEvidenceCount: 1,
      spec: {
        taskType: "workflow",
        completionMode: "auto",
      },
    });
  });
});
