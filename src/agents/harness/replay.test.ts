import { describe, expect, it } from "vitest";
import { WARNING_THRESHOLD, hashToolCall } from "../tool-loop-detection.js";
import { replayHarnessTrace } from "./replay.js";
import type { HarnessTrace } from "./trace-capture.js";

describe("replay", () => {
  it("re-evaluates completion and matches stored completion output", () => {
    const trace: HarnessTrace = {
      version: 1,
      capturedAt: 100,
      task: {
        taskId: "task-fix",
        runtime: "subagent",
        status: "succeeded",
        task: "Fix the worker regression",
        label: "Fix worker regression",
      },
      trajectory: {
        version: 1,
        taskId: "task-fix",
        runId: "run-fix",
        runtime: "subagent",
        mode: "background",
        status: "completed",
        startedAt: 1,
        updatedAt: 10,
        completedAt: 10,
        steps: [],
        evidence: [
          {
            kind: "file_changed",
            at: 5,
            summary: "Modified /tmp/worker.ts",
            path: "/tmp/worker.ts",
            source: "tool",
          },
          {
            kind: "test_passed",
            at: 6,
            summary: "Command passed: pnpm test --filter worker",
            command: "pnpm test --filter worker",
            source: "tool",
          },
        ],
        completion: {
          version: 1,
          evaluatedAt: 10,
          status: "accepted_with_warnings",
          summary: "Completion evidence satisfied with warnings for fix task.",
          spec: {
            version: 1,
            taskType: "fix",
            completionMode: "auto",
            summary:
              "Code fix tasks should leave a code change and at least one validation signal.",
            deliverables: ["Applied the fix", "Captured a validation signal"],
            requiredEvidence: ["file_changed"],
            requireAnyOfEvidence: ["test_passed", "assertion_met"],
            recommendedEvidence: ["answer_provided"],
          },
          satisfiedEvidence: ["file_changed"],
          missingEvidence: [],
          warnings: ["Missing recommended evidence: final answer."],
        },
      },
      progress: [],
      refs: {},
    };

    const result = replayHarnessTrace({
      trace,
    });

    expect(result.completion).toMatchObject({
      status: "accepted_with_warnings",
      spec: {
        taskType: "fix",
      },
    });
    expect(result.completionMatchesStored).toBe(true);
  });

  it("replays loop warnings from progress envelopes", () => {
    const inputFingerprint = hashToolCall("read", { path: "/same.txt" });
    const trace: HarnessTrace = {
      version: 1,
      capturedAt: 100,
      task: {
        taskId: "task-loop",
        runtime: "subagent",
        status: "running",
        task: "Inspect the same file repeatedly",
      },
      progress: Array.from({ length: WARNING_THRESHOLD + 1 }, (_, index) => ({
        toolName: "read",
        toolCategory: "read" as const,
        inputFingerprint,
        toolCallId: `read-${index}`,
        outputFingerprint: "same-output",
        outcomeClass: "success" as const,
        stateDelta: index === 0 ? ("new_result" as const) : ("same_result" as const),
        timestamp: index + 1,
      })),
      refs: {},
    };

    const result = replayHarnessTrace({
      trace,
      loopDetectionConfig: { enabled: true },
    });

    expect(result.loopEvents).toHaveLength(1);
    expect(result.loopEvents[0]).toMatchObject({
      index: WARNING_THRESHOLD,
      action: "warn",
      blocked: false,
      result: {
        stuck: true,
        detector: "generic_repeat",
        level: "warning",
      },
    });
  });
});
