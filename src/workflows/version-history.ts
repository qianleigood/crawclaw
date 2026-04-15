import fs from "node:fs/promises";
import path from "node:path";
import {
  loadWorkflowSpecVersion,
  resolveWorkflowSpecVersionsDirPath,
  saveWorkflowSpecVersion,
  withWorkflowStoreMutation,
  type WorkflowStoreContext,
} from "./store.js";
import type { WorkflowRegistryEntry, WorkflowVersionSnapshot } from "./types.js";

export function buildWorkflowVersionSnapshot(params: {
  specVersion: number;
  reason: string;
  savedBySessionKey?: string;
  spec: WorkflowVersionSnapshot["spec"];
  entry: Pick<
    WorkflowRegistryEntry,
    "description" | "enabled" | "safeForAutoRun" | "requiresApproval" | "tags" | "archivedAt"
  >;
}): WorkflowVersionSnapshot {
  return {
    workflowId: params.spec.workflowId,
    specVersion: params.specVersion,
    savedAt: Date.now(),
    ...(params.savedBySessionKey?.trim()
      ? { savedBySessionKey: params.savedBySessionKey.trim() }
      : {}),
    reason: params.reason,
    spec: params.spec,
    policy: {
      ...(params.entry.description?.trim() ? { description: params.entry.description.trim() } : {}),
      enabled: params.entry.enabled,
      safeForAutoRun: params.entry.safeForAutoRun,
      requiresApproval: params.entry.requiresApproval,
      tags: [...params.entry.tags],
      ...(params.entry.archivedAt ? { archivedAt: params.entry.archivedAt } : {}),
    },
  };
}

export async function saveWorkflowVersionSnapshot(
  context: WorkflowStoreContext,
  snapshot: WorkflowVersionSnapshot,
): Promise<void> {
  await saveWorkflowSpecVersion(context, snapshot);
}

export async function loadWorkflowVersionSnapshot(
  context: WorkflowStoreContext,
  workflowId: string,
  specVersion: number,
): Promise<WorkflowVersionSnapshot | null> {
  return await loadWorkflowSpecVersion(context, workflowId, specVersion);
}

export async function listWorkflowVersionSnapshots(
  context: WorkflowStoreContext,
  workflowId: string,
): Promise<WorkflowVersionSnapshot[]> {
  const dirPath = resolveWorkflowSpecVersionsDirPath(context, workflowId);
  let dirEntries: string[] = [];
  try {
    dirEntries = await fs.readdir(dirPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const versionNumbers = dirEntries
    .map((fileName) => path.parse(fileName).name)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0)
    .toSorted((a, b) => b - a);
  const snapshots = await Promise.all(
    versionNumbers.map(
      async (specVersion) => await loadWorkflowVersionSnapshot(context, workflowId, specVersion),
    ),
  );
  return snapshots.filter((snapshot): snapshot is WorkflowVersionSnapshot => snapshot !== null);
}

export async function deleteWorkflowVersionSnapshots(
  context: WorkflowStoreContext,
  workflowId: string,
): Promise<void> {
  await withWorkflowStoreMutation(context, async (api) => {
    await api.deleteSpecVersions(workflowId);
  });
}
