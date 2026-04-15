import type { ToolLoopDetectionConfig } from "../../config/types.tools.js";
import type { SessionState } from "../../logging/diagnostic-session-state.js";
import { getToolCallStats, detectToolCallLoopByFingerprint, recordProgressEnvelope, type LoopDetectionResult } from "../tool-loop-detection.js";
import { decideLoopPolicyAction, type LoopPolicyAction } from "../loop/policy-engine.js";
import { evaluateCompletionGuard, type CompletionGuardResult } from "../tasks/completion-guard.js";
import type { ProgressEnvelope } from "../loop/types.js";
import type { HarnessTrace } from "./trace-capture.js";

export type HarnessLoopReplayEvent = {
  index: number;
  envelope: ProgressEnvelope;
  result: LoopDetectionResult;
  action: LoopPolicyAction;
  blocked: boolean;
};

export type HarnessReplayResult = {
  trace: HarnessTrace;
  completion?: CompletionGuardResult;
  storedCompletion?: CompletionGuardResult;
  completionMatchesStored?: boolean;
  loopEvents: HarnessLoopReplayEvent[];
  finalLoopStats: ReturnType<typeof getToolCallStats>;
};

function createReplaySessionState(capturedAt: number): SessionState {
  return {
    lastActivity: capturedAt,
    state: "processing",
    queueDepth: 0,
    loopProgressHistory: [],
  };
}

export function replayHarnessTrace(params: {
  trace: HarnessTrace;
  loopDetectionConfig?: ToolLoopDetectionConfig;
}): HarnessReplayResult {
  const state = createReplaySessionState(params.trace.capturedAt);
  const loopEvents: HarnessLoopReplayEvent[] = [];

  for (const [index, envelope] of params.trace.progress.entries()) {
    const result = detectToolCallLoopByFingerprint(
      state,
      {
        toolName: envelope.toolName,
        inputFingerprint: envelope.inputFingerprint,
        isPollingTool: envelope.toolCategory === "poll",
      },
      params.loopDetectionConfig,
    );
    if (result.stuck) {
      const policyDecision = decideLoopPolicyAction(result);
      loopEvents.push({
        index,
        envelope,
        result,
        action: policyDecision?.action ?? "warn",
        blocked: policyDecision?.blocked ?? false,
      });
    }
    recordProgressEnvelope(state, envelope, params.loopDetectionConfig);
    state.lastActivity = envelope.timestamp;
  }

  const completion = params.trace.trajectory
    ? evaluateCompletionGuard({
        task: {
          task: params.trace.task.task,
          label: params.trace.task.label,
        },
        trajectory: {
          status: params.trace.trajectory.status,
          evidence: params.trace.trajectory.evidence,
        },
        evaluatedAt:
          params.trace.trajectory.completedAt ??
          params.trace.trajectory.updatedAt ??
          params.trace.capturedAt,
      })
    : undefined;
  const storedCompletion = params.trace.trajectory?.completion;
  const completionMatchesStored =
    completion && storedCompletion
      ? JSON.stringify(completion) === JSON.stringify(storedCompletion)
      : undefined;

  return {
    trace: params.trace,
    ...(completion ? { completion } : {}),
    ...(storedCompletion ? { storedCompletion } : {}),
    ...(typeof completionMatchesStored === "boolean"
      ? { completionMatchesStored }
      : {}),
    loopEvents,
    finalLoopStats: getToolCallStats(state),
  };
}
