import type { ToolLoopDetectionConfig } from "../../config/types.tools.js";
import { WARNING_THRESHOLD, hashToolCall } from "../tool-loop-detection.js";
import type { ProgressEnvelope } from "../loop/types.js";
import type { HarnessTrace } from "./trace-capture.js";
import { replayHarnessTrace, type HarnessReplayResult } from "./replay.js";

export type HarnessScenario = {
  name: string;
  trace: HarnessTrace;
  loopDetectionConfig?: ToolLoopDetectionConfig;
};

function createRepeatedReadProgress(count: number): ProgressEnvelope[] {
  const inputFingerprint = hashToolCall("read", { path: "/same.txt" });
  return Array.from({ length: count }, (_, index) => ({
    toolName: "read",
    toolCategory: "read" as const,
    inputFingerprint,
    toolCallId: `read-${index}`,
    outputFingerprint: "same-output",
    outcomeClass: "success" as const,
    stateDelta: index === 0 ? ("new_result" as const) : ("same_result" as const),
    timestamp: index + 1,
  }));
}

export function getBuiltinHarnessScenarios(): HarnessScenario[] {
  return [
    {
      name: "fix-complete",
      trace: {
        version: 1,
        capturedAt: 100,
        task: {
          taskId: "task-fix-complete",
          runtime: "subagent",
          status: "succeeded",
          task: "Fix the worker regression",
          label: "Fix worker regression",
        },
        trajectory: {
          version: 1,
          taskId: "task-fix-complete",
          runId: "run-fix-complete",
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
            {
              kind: "answer_provided",
              at: 10,
              summary: "Patched the worker flow and verified the fix.",
              source: "assistant",
              confidence: 1,
            },
          ],
        },
        progress: [],
        refs: {},
      },
    },
    {
      name: "fix-missing-verification",
      trace: {
        version: 1,
        capturedAt: 100,
        task: {
          taskId: "task-fix-incomplete",
          runtime: "subagent",
          status: "succeeded",
          task: "Fix the worker regression",
        },
        trajectory: {
          version: 1,
          taskId: "task-fix-incomplete",
          runId: "run-fix-incomplete",
          runtime: "subagent",
          mode: "background",
          status: "completed",
          startedAt: 1,
          updatedAt: 8,
          completedAt: 8,
          steps: [],
          evidence: [
            {
              kind: "file_changed",
              at: 5,
              summary: "Modified /tmp/worker.ts",
              path: "/tmp/worker.ts",
              source: "tool",
            },
          ],
        },
        progress: [],
        refs: {},
      },
    },
    {
      name: "repeat-no-progress-warning",
      loopDetectionConfig: { enabled: true },
      trace: {
        version: 1,
        capturedAt: 100,
        task: {
          taskId: "task-loop-warning",
          runtime: "subagent",
          status: "running",
          task: "Inspect the same file repeatedly",
        },
        progress: createRepeatedReadProgress(WARNING_THRESHOLD + 1),
        refs: {},
      },
    },
  ];
}

export function runHarnessScenario(params: {
  scenario: HarnessScenario;
  loopDetectionConfig?: ToolLoopDetectionConfig;
}): HarnessReplayResult {
  return replayHarnessTrace({
    trace: params.scenario.trace,
    loopDetectionConfig: params.loopDetectionConfig ?? params.scenario.loopDetectionConfig,
  });
}
