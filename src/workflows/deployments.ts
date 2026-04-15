import {
  loadWorkflowDeploymentStore,
  withWorkflowStoreMutation,
  type WorkflowStoreContext,
} from "./store.js";
import type { WorkflowDeploymentRecord, WorkflowRegistryEntry } from "./types.js";

export async function listWorkflowDeployments(
  context: WorkflowStoreContext,
  workflowId?: string,
): Promise<WorkflowDeploymentRecord[]> {
  const store = await loadWorkflowDeploymentStore(context);
  const deployments = workflowId
    ? store.deployments.filter((record) => record.workflowId === workflowId)
    : store.deployments;
  return [...deployments].toSorted((a, b) => b.deploymentVersion - a.deploymentVersion);
}

export async function recordWorkflowDeployment(
  context: WorkflowStoreContext,
  record: WorkflowDeploymentRecord,
): Promise<WorkflowDeploymentRecord> {
  return await withWorkflowStoreMutation(context, async (api) => {
    const store = await api.loadDeploymentStore();
    store.deployments = store.deployments.filter(
      (existing) =>
        !(
          existing.workflowId === record.workflowId &&
          existing.deploymentVersion === record.deploymentVersion
        ),
    );
    store.deployments.push(record);
    await api.saveDeploymentStore(store);
    return record;
  });
}

export async function deleteWorkflowDeployments(
  context: WorkflowStoreContext,
  workflowId: string,
): Promise<number> {
  return await withWorkflowStoreMutation(context, async (api) => {
    const store = await api.loadDeploymentStore();
    const before = store.deployments.length;
    store.deployments = store.deployments.filter((record) => record.workflowId !== workflowId);
    const removed = before - store.deployments.length;
    if (removed > 0) {
      await api.saveDeploymentStore(store);
    }
    return removed;
  });
}

export async function getCurrentWorkflowDeployment(
  context: WorkflowStoreContext,
  entry: Pick<WorkflowRegistryEntry, "workflowId" | "deploymentVersion">,
): Promise<WorkflowDeploymentRecord | null> {
  if (entry.deploymentVersion <= 0) {
    return null;
  }
  const store = await loadWorkflowDeploymentStore(context);
  return (
    store.deployments.find(
      (record) =>
        record.workflowId === entry.workflowId &&
        record.deploymentVersion === entry.deploymentVersion,
    ) ?? null
  );
}
