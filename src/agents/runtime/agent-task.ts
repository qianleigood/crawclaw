import type {
  AgentTaskMetadata,
  AgentTaskMode,
  TaskRecord,
} from "../../tasks/task-registry.types.js";

export function normalizeAgentTaskMetadata(
  metadata: AgentTaskMetadata | null | undefined,
): AgentTaskMetadata | undefined {
  if (!metadata) {
    return undefined;
  }
  const parentAgentId = metadata.parentAgentId?.trim() || undefined;
  const mode =
    metadata.mode === "foreground" || metadata.mode === "background" ? metadata.mode : undefined;
  const transcriptRef = metadata.transcriptRef?.trim() || undefined;
  const runtimeStateRef = metadata.runtimeStateRef?.trim() || undefined;
  const trajectoryRef = metadata.trajectoryRef?.trim() || undefined;
  const capabilitySnapshotRef = metadata.capabilitySnapshotRef?.trim() || undefined;
  const spawnSource = metadata.spawnSource?.trim() || undefined;
  if (
    !parentAgentId &&
    !mode &&
    !transcriptRef &&
    !runtimeStateRef &&
    !trajectoryRef &&
    !capabilitySnapshotRef &&
    !spawnSource
  ) {
    return undefined;
  }
  return {
    ...(parentAgentId ? { parentAgentId } : {}),
    ...(mode ? { mode } : {}),
    ...(transcriptRef ? { transcriptRef } : {}),
    ...(runtimeStateRef ? { runtimeStateRef } : {}),
    ...(trajectoryRef ? { trajectoryRef } : {}),
    ...(capabilitySnapshotRef ? { capabilitySnapshotRef } : {}),
    ...(spawnSource ? { spawnSource } : {}),
  };
}

export function isAgentTaskRecord(
  task: Pick<TaskRecord, "agentId" | "agentMetadata">,
): task is Pick<TaskRecord, "agentId" | "agentMetadata"> & { agentId: string } {
  return Boolean(task.agentId?.trim());
}

export function getAgentTaskMode(
  task: Pick<TaskRecord, "agentMetadata">,
): AgentTaskMode | undefined {
  return task.agentMetadata?.mode;
}

export function getParentAgentId(task: Pick<TaskRecord, "agentMetadata">): string | undefined {
  return task.agentMetadata?.parentAgentId?.trim() || undefined;
}
