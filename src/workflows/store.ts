import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  WorkflowDeploymentStore,
  WorkflowExecutionStore,
  WorkflowRegistryStore,
  WorkflowSpec,
  WorkflowVersionSnapshot,
} from "./types.js";

export type WorkflowStoreContext = {
  workspaceDir?: string;
  agentDir?: string;
};

const WORKFLOW_ROOT_SEGMENTS = [".crawclaw", "workflows"] as const;
const REGISTRY_FILE = "registry.json";
const EXECUTIONS_FILE = "executions.json";
const DEPLOYMENTS_FILE = "deployments.json";
const SPECS_DIR = "specs";
const SPEC_VERSIONS_DIR = "spec-versions";
const workflowRootMutationQueues = new Map<string, Promise<void>>();

function defaultRegistryStore(): WorkflowRegistryStore {
  return {
    version: 1,
    updatedAt: Date.now(),
    workflows: [],
  };
}

function defaultExecutionStore(): WorkflowExecutionStore {
  return {
    version: 1,
    updatedAt: Date.now(),
    executions: [],
  };
}

function defaultDeploymentStore(): WorkflowDeploymentStore {
  return {
    version: 1,
    updatedAt: Date.now(),
    deployments: [],
  };
}

export function resolveWorkflowRoot(context: WorkflowStoreContext): string | null {
  const workspaceDir = context.workspaceDir?.trim();
  if (workspaceDir) {
    return path.join(workspaceDir, ...WORKFLOW_ROOT_SEGMENTS);
  }
  const agentDir = context.agentDir?.trim();
  if (agentDir) {
    return path.join(agentDir, "workflows");
  }
  return null;
}

export function requireWorkflowRoot(context: WorkflowStoreContext): string {
  const root = resolveWorkflowRoot(context);
  if (!root) {
    throw new Error("Workflow tools require workspaceDir or agentDir.");
  }
  return root;
}

export function resolveWorkflowRegistryPath(context: WorkflowStoreContext): string {
  return path.join(requireWorkflowRoot(context), REGISTRY_FILE);
}

export function resolveWorkflowExecutionStorePath(context: WorkflowStoreContext): string {
  return path.join(requireWorkflowRoot(context), EXECUTIONS_FILE);
}

export function resolveWorkflowDeploymentStorePath(context: WorkflowStoreContext): string {
  return path.join(requireWorkflowRoot(context), DEPLOYMENTS_FILE);
}

export function resolveWorkflowSpecPath(context: WorkflowStoreContext, workflowId: string): string {
  return path.join(requireWorkflowRoot(context), SPECS_DIR, `${workflowId}.json`);
}

export function resolveWorkflowSpecVersionsDirPath(
  context: WorkflowStoreContext,
  workflowId: string,
): string {
  return path.join(requireWorkflowRoot(context), SPEC_VERSIONS_DIR, workflowId);
}

export function resolveWorkflowSpecVersionPath(
  context: WorkflowStoreContext,
  workflowId: string,
  specVersion: number,
): string {
  return path.join(resolveWorkflowSpecVersionsDirPath(context, workflowId), `${specVersion}.json`);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFileAtomic(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function deleteFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function deleteDirectoryIfExists(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      throw error;
    }
  }
}

function queueWorkflowRootMutation<T>(root: string, mutation: () => Promise<T>): Promise<T> {
  const previous = workflowRootMutationQueues.get(root) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(mutation);
  const gate = next.then(
    () => undefined,
    () => undefined,
  );
  workflowRootMutationQueues.set(root, gate);
  return next.finally(() => {
    if (workflowRootMutationQueues.get(root) === gate) {
      workflowRootMutationQueues.delete(root);
    }
  });
}

async function loadWorkflowRegistryStoreInternal(filePath: string): Promise<WorkflowRegistryStore> {
  const existing = await readJsonFile<WorkflowRegistryStore>(filePath);
  return existing ?? defaultRegistryStore();
}

async function loadWorkflowExecutionStoreInternal(
  filePath: string,
): Promise<WorkflowExecutionStore> {
  const existing = await readJsonFile<WorkflowExecutionStore>(filePath);
  return existing ?? defaultExecutionStore();
}

async function loadWorkflowDeploymentStoreInternal(
  filePath: string,
): Promise<WorkflowDeploymentStore> {
  const existing = await readJsonFile<WorkflowDeploymentStore>(filePath);
  return existing ?? defaultDeploymentStore();
}

async function saveWorkflowRegistryStoreInternal(
  filePath: string,
  store: WorkflowRegistryStore,
): Promise<void> {
  await writeJsonFileAtomic(filePath, {
    ...store,
    updatedAt: Date.now(),
  });
}

async function saveWorkflowExecutionStoreInternal(
  filePath: string,
  store: WorkflowExecutionStore,
): Promise<void> {
  await writeJsonFileAtomic(filePath, {
    ...store,
    updatedAt: Date.now(),
  });
}

async function saveWorkflowDeploymentStoreInternal(
  filePath: string,
  store: WorkflowDeploymentStore,
): Promise<void> {
  await writeJsonFileAtomic(filePath, {
    ...store,
    updatedAt: Date.now(),
  });
}

async function saveWorkflowSpecInternal(filePath: string, spec: WorkflowSpec): Promise<void> {
  await writeJsonFileAtomic(filePath, spec);
}

async function saveWorkflowSpecVersionInternal(
  filePath: string,
  snapshot: WorkflowVersionSnapshot,
): Promise<void> {
  await writeJsonFileAtomic(filePath, snapshot);
}

export type WorkflowStoreMutationApi = {
  root: string;
  loadRegistryStore: () => Promise<WorkflowRegistryStore>;
  saveRegistryStore: (store: WorkflowRegistryStore) => Promise<void>;
  loadExecutionStore: () => Promise<WorkflowExecutionStore>;
  saveExecutionStore: (store: WorkflowExecutionStore) => Promise<void>;
  loadDeploymentStore: () => Promise<WorkflowDeploymentStore>;
  saveDeploymentStore: (store: WorkflowDeploymentStore) => Promise<void>;
  loadSpec: (workflowId: string) => Promise<WorkflowSpec | null>;
  saveSpec: (spec: WorkflowSpec) => Promise<void>;
  deleteSpec: (workflowId: string) => Promise<void>;
  loadSpecVersion: (
    workflowId: string,
    specVersion: number,
  ) => Promise<WorkflowVersionSnapshot | null>;
  saveSpecVersion: (snapshot: WorkflowVersionSnapshot) => Promise<void>;
  deleteSpecVersions: (workflowId: string) => Promise<void>;
};

export async function withWorkflowStoreMutation<T>(
  context: WorkflowStoreContext,
  mutation: (api: WorkflowStoreMutationApi) => Promise<T>,
): Promise<T> {
  const root = requireWorkflowRoot(context);
  return await queueWorkflowRootMutation(root, async () => {
    const api: WorkflowStoreMutationApi = {
      root,
      loadRegistryStore: async () =>
        await loadWorkflowRegistryStoreInternal(path.join(root, REGISTRY_FILE)),
      saveRegistryStore: async (store) =>
        await saveWorkflowRegistryStoreInternal(path.join(root, REGISTRY_FILE), store),
      loadExecutionStore: async () =>
        await loadWorkflowExecutionStoreInternal(path.join(root, EXECUTIONS_FILE)),
      saveExecutionStore: async (store) =>
        await saveWorkflowExecutionStoreInternal(path.join(root, EXECUTIONS_FILE), store),
      loadDeploymentStore: async () =>
        await loadWorkflowDeploymentStoreInternal(path.join(root, DEPLOYMENTS_FILE)),
      saveDeploymentStore: async (store) =>
        await saveWorkflowDeploymentStoreInternal(path.join(root, DEPLOYMENTS_FILE), store),
      loadSpec: async (workflowId) =>
        await readJsonFile<WorkflowSpec>(path.join(root, SPECS_DIR, `${workflowId}.json`)),
      saveSpec: async (spec) =>
        await saveWorkflowSpecInternal(path.join(root, SPECS_DIR, `${spec.workflowId}.json`), spec),
      deleteSpec: async (workflowId) =>
        await deleteFileIfExists(path.join(root, SPECS_DIR, `${workflowId}.json`)),
      loadSpecVersion: async (workflowId, specVersion) =>
        await readJsonFile<WorkflowVersionSnapshot>(
          path.join(root, SPEC_VERSIONS_DIR, workflowId, `${specVersion}.json`),
        ),
      saveSpecVersion: async (snapshot) =>
        await saveWorkflowSpecVersionInternal(
          path.join(root, SPEC_VERSIONS_DIR, snapshot.workflowId, `${snapshot.specVersion}.json`),
          snapshot,
        ),
      deleteSpecVersions: async (workflowId) =>
        await deleteDirectoryIfExists(path.join(root, SPEC_VERSIONS_DIR, workflowId)),
    };
    return await mutation(api);
  });
}

export async function loadWorkflowRegistryStore(
  context: WorkflowStoreContext,
): Promise<WorkflowRegistryStore> {
  return await loadWorkflowRegistryStoreInternal(resolveWorkflowRegistryPath(context));
}

export async function loadWorkflowExecutionStore(
  context: WorkflowStoreContext,
): Promise<WorkflowExecutionStore> {
  return await loadWorkflowExecutionStoreInternal(resolveWorkflowExecutionStorePath(context));
}

export async function loadWorkflowDeploymentStore(
  context: WorkflowStoreContext,
): Promise<WorkflowDeploymentStore> {
  return await loadWorkflowDeploymentStoreInternal(resolveWorkflowDeploymentStorePath(context));
}

export async function mutateWorkflowRegistryStore<T>(
  context: WorkflowStoreContext,
  mutation: (store: WorkflowRegistryStore) => Promise<T> | T,
): Promise<T> {
  return await withWorkflowStoreMutation(context, async (api) => {
    const store = await api.loadRegistryStore();
    const result = await mutation(store);
    await api.saveRegistryStore(store);
    return result;
  });
}

export async function mutateWorkflowExecutionStore<T>(
  context: WorkflowStoreContext,
  mutation: (store: WorkflowExecutionStore) => Promise<T> | T,
): Promise<T> {
  return await withWorkflowStoreMutation(context, async (api) => {
    const store = await api.loadExecutionStore();
    const result = await mutation(store);
    await api.saveExecutionStore(store);
    return result;
  });
}

export async function saveWorkflowRegistryStore(
  context: WorkflowStoreContext,
  store: WorkflowRegistryStore,
): Promise<void> {
  await withWorkflowStoreMutation(context, async (api) => {
    await api.saveRegistryStore(store);
  });
}

export async function saveWorkflowExecutionStore(
  context: WorkflowStoreContext,
  store: WorkflowExecutionStore,
): Promise<void> {
  await withWorkflowStoreMutation(context, async (api) => {
    await api.saveExecutionStore(store);
  });
}

export async function saveWorkflowDeploymentStore(
  context: WorkflowStoreContext,
  store: WorkflowDeploymentStore,
): Promise<void> {
  await withWorkflowStoreMutation(context, async (api) => {
    await api.saveDeploymentStore(store);
  });
}

export async function loadWorkflowSpec(
  context: WorkflowStoreContext,
  workflowId: string,
): Promise<WorkflowSpec | null> {
  const filePath = resolveWorkflowSpecPath(context, workflowId);
  return await readJsonFile<WorkflowSpec>(filePath);
}

export async function saveWorkflowSpec(
  context: WorkflowStoreContext,
  spec: WorkflowSpec,
): Promise<void> {
  await withWorkflowStoreMutation(context, async (api) => {
    await api.saveSpec(spec);
  });
}

export async function deleteWorkflowSpec(
  context: WorkflowStoreContext,
  workflowId: string,
): Promise<void> {
  await withWorkflowStoreMutation(context, async (api) => {
    await api.deleteSpec(workflowId);
  });
}

export async function loadWorkflowSpecVersion(
  context: WorkflowStoreContext,
  workflowId: string,
  specVersion: number,
): Promise<WorkflowVersionSnapshot | null> {
  return await withWorkflowStoreMutation(context, async (api) => {
    return await api.loadSpecVersion(workflowId, specVersion);
  });
}

export async function saveWorkflowSpecVersion(
  context: WorkflowStoreContext,
  snapshot: WorkflowVersionSnapshot,
): Promise<void> {
  await withWorkflowStoreMutation(context, async (api) => {
    await api.saveSpecVersion(snapshot);
  });
}

export async function deleteWorkflowSpecVersions(
  context: WorkflowStoreContext,
  workflowId: string,
): Promise<void> {
  await withWorkflowStoreMutation(context, async (api) => {
    await api.deleteSpecVersions(workflowId);
  });
}
