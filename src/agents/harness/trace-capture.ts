import { readAgentTaskRuntimeMetadataSync } from "../runtime/agent-metadata-store.js";
import { readTaskTrajectorySync, type TaskTrajectory } from "../tasks/task-trajectory.js";
import type { ProgressEnvelope } from "../loop/types.js";
import { getTaskById } from "../../tasks/runtime-internal.js";
import type {
  AgentTaskMetadata,
  TaskRecord,
  TaskRuntime,
  TaskStatus,
  TaskTerminalOutcome,
} from "../../tasks/task-registry.types.js";

export type HarnessTaskSnapshot = {
  taskId: string;
  runtime: TaskRuntime;
  status: TaskStatus;
  task: string;
  label?: string;
  runId?: string;
  agentId?: string;
  agentMetadata?: AgentTaskMetadata;
  progressSummary?: string;
  terminalSummary?: string;
  terminalOutcome?: TaskTerminalOutcome;
};

export type HarnessTrace = {
  version: 1;
  capturedAt: number;
  task: HarnessTaskSnapshot;
  trajectory?: TaskTrajectory;
  progress: ProgressEnvelope[];
  refs: {
    runtimeStateRef?: string;
    trajectoryRef?: string;
  };
};

const HARNESS_TRACE_VERSION = 1 as const;

function toHarnessTaskSnapshot(task: TaskRecord): HarnessTaskSnapshot {
  return {
    taskId: task.taskId,
    runtime: task.runtime,
    status: task.status,
    task: task.task,
    ...(task.label ? { label: task.label } : {}),
    ...(task.runId ? { runId: task.runId } : {}),
    ...(task.agentId ? { agentId: task.agentId } : {}),
    ...(task.agentMetadata ? { agentMetadata: task.agentMetadata } : {}),
    ...(task.progressSummary ? { progressSummary: task.progressSummary } : {}),
    ...(task.terminalSummary ? { terminalSummary: task.terminalSummary } : {}),
    ...(task.terminalOutcome ? { terminalOutcome: task.terminalOutcome } : {}),
  };
}

export function captureTaskHarnessTrace(params: {
  taskId: string;
  progress?: ProgressEnvelope[];
}): HarnessTrace | undefined {
  const task = getTaskById(params.taskId);
  if (!task) {
    return undefined;
  }
  const runtimeStateRef = task.agentMetadata?.runtimeStateRef;
  const runtimeMetadata = readAgentTaskRuntimeMetadataSync(runtimeStateRef);
  const trajectoryRef = task.agentMetadata?.trajectoryRef ?? runtimeMetadata?.trajectoryRef;
  const trajectory = readTaskTrajectorySync(trajectoryRef);
  return {
    version: HARNESS_TRACE_VERSION,
    capturedAt: Date.now(),
    task: toHarnessTaskSnapshot(task),
    ...(trajectory ? { trajectory } : {}),
    progress: [...(params.progress ?? [])],
    refs: {
      ...(runtimeStateRef ? { runtimeStateRef } : {}),
      ...(trajectoryRef ? { trajectoryRef } : {}),
    },
  };
}
