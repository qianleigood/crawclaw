import { randomUUID } from "node:crypto";
import { getCurrentWorkflowDeployment, listWorkflowDeployments } from "./deployments.js";
import { resolveWorkflowSkillPortabilityHint } from "./skill-portability.js";
import { applyWorkflowDefinitionPatch } from "./spec-patch.js";
import {
  loadWorkflowRegistryStore,
  loadWorkflowSpec,
  mutateWorkflowRegistryStore,
  requireWorkflowRoot,
  resolveWorkflowSpecPath,
  withWorkflowStoreMutation,
  type WorkflowStoreContext,
} from "./store.js";
import type {
  WorkflowDefinitionPatch,
  WorkflowDeploymentRecord,
  WorkflowFieldSpec,
  WorkflowHttpMethod,
  WorkflowInvocationHint,
  WorkflowRegistryEntry,
  WorkflowRegistryStore,
  WorkflowSpec,
  WorkflowStepActivationMode,
  WorkflowStepSpec,
  WorkflowStepKind,
  WorkflowTopology,
  WorkflowVersionSnapshot,
} from "./types.js";
import { buildWorkflowVersionSnapshot, listWorkflowVersionSnapshots } from "./version-history.js";

export type WorkflowDraftStepInput = {
  title: string;
  goal?: string;
  kind?: WorkflowStepKind;
  skill?: string;
  prompt?: string;
  service?: string;
  serviceUrl?: string;
  serviceMethod?: WorkflowHttpMethod;
  allowedTools?: string[];
  allowedSkills?: string[];
  waitKind?: "input" | "external";
  notes?: string;
  path?: string;
  branchGroup?: string;
  activationMode?: WorkflowStepActivationMode;
  activationWhen?: string;
  activationFromStepIds?: string[];
  parallelFailurePolicy?: "fail_fast" | "continue";
  parallelJoinPolicy?: "all" | "best_effort";
  maxActiveBranches?: number;
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTriesMs?: number;
  compensationMode?: "none" | "crawclaw_agent";
  compensationGoal?: string;
  compensationAllowedTools?: string[];
  compensationAllowedSkills?: string[];
  compensationTimeoutMs?: number;
  compensationMaxSteps?: number;
  terminalOnSuccess?: boolean;
};

type CreateWorkflowDraftParams = WorkflowStoreContext & {
  name: string;
  goal: string;
  topology?: WorkflowTopology;
  description?: string;
  sourceSummary?: string;
  steps?: string[];
  stepSpecs?: WorkflowDraftStepInput[];
  tags?: string[];
  inputs?: string[];
  outputs?: string[];
  safeForAutoRun?: boolean;
  requiresApproval?: boolean;
  sessionKey?: string;
  sessionId?: string;
};

function normalizeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "workflow";
}

function normalizeStringList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildFieldSpecs(names: string[] | undefined): WorkflowFieldSpec[] {
  return normalizeStringList(names).map((name) => ({
    name,
    type: "string",
    required: false,
  }));
}

function normalizeHttpMethod(method: string | undefined): WorkflowHttpMethod | undefined {
  const normalized = method?.trim().toUpperCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "GET" ||
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE" ||
    normalized === "HEAD" ||
    normalized === "OPTIONS"
  ) {
    return normalized;
  }
  return undefined;
}

function hasBranchAwareMetadata(step: WorkflowStepSpec): boolean {
  return (
    (step.path?.trim() && step.path.trim() !== "main") ||
    Boolean(step.branchGroup?.trim()) ||
    Boolean(step.activation?.when?.trim()) ||
    Boolean(step.activation?.fromStepIds?.length) ||
    (step.activation?.mode !== undefined && step.activation.mode !== "sequential")
  );
}

function inferWorkflowTopology(
  explicitTopology: WorkflowTopology | undefined,
  steps: WorkflowStepSpec[],
): WorkflowTopology {
  const inferred = steps.some((step) => hasBranchAwareMetadata(step)) ? "branch_v2" : "linear_v1";
  if (explicitTopology === "linear_v1" && inferred === "branch_v2") {
    throw new Error(
      "Workflow step specs include branch-aware metadata, but topology was forced to linear_v1.",
    );
  }
  return explicitTopology ?? inferred;
}

function deriveInvocationHint(entry: WorkflowRegistryEntry): WorkflowInvocationHint {
  if (entry.archivedAt) {
    return {
      canRun: false,
      autoRunnable: false,
      recommendedAction: "skip",
      reason: "Workflow is archived.",
    };
  }
  if (!entry.enabled) {
    return {
      canRun: false,
      autoRunnable: false,
      recommendedAction: "skip",
      reason: "Workflow is disabled.",
    };
  }
  if (entry.deploymentState !== "deployed") {
    return {
      canRun: false,
      autoRunnable: false,
      recommendedAction: "skip",
      reason: "Workflow is still draft and must be deployed first.",
    };
  }
  if (entry.requiresApproval) {
    return {
      canRun: true,
      autoRunnable: false,
      recommendedAction: "ask",
      reason: "Workflow requires explicit operator approval before running.",
    };
  }
  if (entry.safeForAutoRun) {
    return {
      canRun: true,
      autoRunnable: true,
      recommendedAction: "run",
      reason: "Workflow is deployed, enabled, and marked safe for auto-run.",
    };
  }
  return {
    canRun: true,
    autoRunnable: false,
    recommendedAction: "ask",
    reason: "Workflow is runnable, but not marked safe for autonomous execution.",
  };
}

function toLegacyStepSpecs(steps: string[] | undefined): WorkflowDraftStepInput[] {
  const normalized = normalizeStringList(steps);
  if (normalized.length === 0) {
    return [
      {
        title: "Primary step",
      },
    ];
  }
  return normalized.map((step) => ({
    title: step,
    goal: step,
  }));
}

async function buildStepSpecs(
  context: WorkflowStoreContext,
  goal: string,
  steps: string[] | undefined,
  stepSpecs: WorkflowDraftStepInput[] | undefined,
): Promise<{
  steps: WorkflowStepSpec[];
  impliedTags: string[];
  inferredRequiresApproval?: boolean;
}> {
  const normalizedSpecs =
    Array.isArray(stepSpecs) && stepSpecs.length > 0 ? stepSpecs : toLegacyStepSpecs(steps);
  const impliedTags = new Set<string>();
  let inferredRequiresApproval: boolean | undefined;
  const result: WorkflowStepSpec[] = [];

  for (let index = 0; index < normalizedSpecs.length; index += 1) {
    const input = normalizedSpecs[index];
    const sourceSkill = input.skill?.trim();
    const portabilityHint = sourceSkill
      ? resolveWorkflowSkillPortabilityHint(context, sourceSkill)
      : null;
    if (portabilityHint?.portability === "non_portable") {
      throw new Error(
        `Skill "${portabilityHint.skillName}" is marked non-portable for workflow deployment.`,
      );
    }
    const stepKind = input.kind ?? portabilityHint?.stepKind ?? "crawclaw_agent";
    const mergedAllowedSkills = Array.from(
      new Set(
        [sourceSkill, ...(input.allowedSkills ?? []), ...(portabilityHint?.allowedSkills ?? [])]
          .map((value) => value?.trim() ?? "")
          .filter(Boolean),
      ),
    );
    const mergedAllowedTools = Array.from(
      new Set(
        [...(input.allowedTools ?? []), ...(portabilityHint?.allowedTools ?? [])]
          .map((value) => value?.trim() ?? "")
          .filter(Boolean),
      ),
    );
    for (const tag of portabilityHint?.tags ?? []) {
      impliedTags.add(tag);
    }
    if (portabilityHint?.requiresApproval) {
      inferredRequiresApproval = true;
    }
    result.push({
      id: `step_${index + 1}`,
      kind: stepKind,
      title: input.title.trim() || `Step ${index + 1}`,
      goal: input.goal?.trim() || input.title.trim() || goal,
      ...(input.prompt?.trim() ? { prompt: input.prompt.trim() } : {}),
      ...(input.service?.trim() ? { service: input.service.trim() } : {}),
      ...(sourceSkill ? { sourceSkill } : {}),
      ...(portabilityHint?.portability ? { portability: portabilityHint.portability } : {}),
      ...(portabilityHint?.tags?.length ? { tags: portabilityHint.tags } : {}),
      ...(input.notes?.trim() || portabilityHint?.notes
        ? { notes: input.notes?.trim() || portabilityHint?.notes }
        : {}),
      ...(trimToUndefined(input.path) ? { path: trimToUndefined(input.path) } : {}),
      ...(trimToUndefined(input.branchGroup)
        ? { branchGroup: trimToUndefined(input.branchGroup) }
        : {}),
      ...(input.activationMode ||
      trimToUndefined(input.activationWhen) ||
      normalizeStringList(input.activationFromStepIds).length > 0 ||
      input.parallelFailurePolicy ||
      input.parallelJoinPolicy ||
      typeof input.maxActiveBranches === "number" ||
      typeof input.retryOnFail === "boolean" ||
      typeof input.maxTries === "number" ||
      typeof input.waitBetweenTriesMs === "number"
        ? {
            activation: {
              ...(input.activationMode ? { mode: input.activationMode } : {}),
              ...(trimToUndefined(input.activationWhen)
                ? { when: trimToUndefined(input.activationWhen) }
                : {}),
              ...(normalizeStringList(input.activationFromStepIds).length > 0
                ? { fromStepIds: normalizeStringList(input.activationFromStepIds) }
                : {}),
              ...(input.parallelFailurePolicy ||
              input.parallelJoinPolicy ||
              typeof input.maxActiveBranches === "number" ||
              typeof input.retryOnFail === "boolean" ||
              typeof input.maxTries === "number" ||
              typeof input.waitBetweenTriesMs === "number"
                ? {
                    parallel: {
                      ...(input.parallelFailurePolicy
                        ? { failurePolicy: input.parallelFailurePolicy }
                        : {}),
                      ...(input.parallelJoinPolicy ? { joinPolicy: input.parallelJoinPolicy } : {}),
                      ...(typeof input.maxActiveBranches === "number"
                        ? { maxActiveBranches: input.maxActiveBranches }
                        : {}),
                      ...(typeof input.retryOnFail === "boolean"
                        ? { retryOnFail: input.retryOnFail }
                        : {}),
                      ...(typeof input.maxTries === "number" ? { maxTries: input.maxTries } : {}),
                      ...(typeof input.waitBetweenTriesMs === "number"
                        ? { waitBetweenTriesMs: input.waitBetweenTriesMs }
                        : {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(stepKind === "crawclaw_agent" &&
      (input.compensationMode ||
        input.compensationGoal?.trim() ||
        normalizeStringList(input.compensationAllowedTools).length > 0 ||
        normalizeStringList(input.compensationAllowedSkills).length > 0 ||
        typeof input.compensationTimeoutMs === "number" ||
        typeof input.compensationMaxSteps === "number")
        ? {
            compensation: {
              ...(input.compensationMode ? { mode: input.compensationMode } : {}),
              ...(input.compensationGoal?.trim() ? { goal: input.compensationGoal.trim() } : {}),
              ...(normalizeStringList(input.compensationAllowedTools).length > 0
                ? { allowedTools: normalizeStringList(input.compensationAllowedTools) }
                : {}),
              ...(normalizeStringList(input.compensationAllowedSkills).length > 0
                ? { allowedSkills: normalizeStringList(input.compensationAllowedSkills) }
                : {}),
              ...(typeof input.compensationTimeoutMs === "number"
                ? { timeoutMs: input.compensationTimeoutMs }
                : {}),
              ...(typeof input.compensationMaxSteps === "number"
                ? { maxSteps: input.compensationMaxSteps }
                : {}),
            },
          }
        : {}),
      ...(input.terminalOnSuccess ? { terminalOnSuccess: true } : {}),
      ...(stepKind === "service" && (input.serviceUrl?.trim() || portabilityHint?.serviceUrl)
        ? {
            serviceRequest: {
              url: input.serviceUrl?.trim() || portabilityHint!.serviceUrl!,
              ...(normalizeHttpMethod(input.serviceMethod) || portabilityHint?.serviceMethod
                ? {
                    method:
                      normalizeHttpMethod(input.serviceMethod) || portabilityHint?.serviceMethod,
                  }
                : {}),
            },
          }
        : {}),
      ...(stepKind === "crawclaw_agent" &&
      (mergedAllowedSkills.length > 0 || mergedAllowedTools.length > 0)
        ? {
            agent: {
              ...(mergedAllowedSkills.length > 0 ? { allowedSkills: mergedAllowedSkills } : {}),
              ...(mergedAllowedTools.length > 0 ? { allowedTools: mergedAllowedTools } : {}),
            },
          }
        : {}),
      ...(stepKind === "human_wait" &&
      (input.prompt?.trim() || input.waitKind || portabilityHint?.waitKind)
        ? {
            wait: {
              ...(input.waitKind || portabilityHint?.waitKind
                ? { kind: input.waitKind ?? portabilityHint?.waitKind }
                : {}),
              ...(input.prompt?.trim() ? { prompt: input.prompt.trim() } : {}),
            },
          }
        : {}),
    });
  }

  return {
    steps: result,
    impliedTags: [...impliedTags],
    ...(inferredRequiresApproval !== undefined ? { inferredRequiresApproval } : {}),
  };
}

function findWorkflowEntry(
  store: WorkflowRegistryStore,
  ref: string,
): WorkflowRegistryEntry | undefined {
  const normalized = ref.trim().toLowerCase();
  return store.workflows.find(
    (entry) =>
      entry.workflowId.toLowerCase() === normalized ||
      entry.name.trim().toLowerCase() === normalized,
  );
}

function buildWorkflowSnapshot(
  entry: WorkflowRegistryEntry,
  spec: WorkflowSpec,
  reason: string,
  savedBySessionKey?: string,
): WorkflowVersionSnapshot {
  return buildWorkflowVersionSnapshot({
    specVersion: entry.specVersion,
    reason,
    savedBySessionKey,
    spec,
    entry,
  });
}

export async function createWorkflowDraft(params: CreateWorkflowDraftParams): Promise<{
  entry: WorkflowRegistryEntry;
  spec: WorkflowSpec;
  storeRoot: string;
  specPath: string;
}> {
  const name = params.name.trim();
  const goal = params.goal.trim();
  if (!name) {
    throw new Error("Workflow name required.");
  }
  if (!goal) {
    throw new Error("Workflow goal required.");
  }

  return await withWorkflowStoreMutation(params, async (api) => {
    const store = await api.loadRegistryStore();
    const duplicate = store.workflows.find(
      (entry) => entry.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      throw new Error(`Workflow "${name}" already exists.`);
    }

    const now = Date.now();
    const workflowId = `wf_${normalizeSlug(name)}_${randomUUID().slice(0, 8)}`;
    const builtSteps = await buildStepSpecs(params, goal, params.steps, params.stepSpecs);
    const topology = inferWorkflowTopology(params.topology, builtSteps.steps);
    const specTags = normalizeStringList([
      ...normalizeStringList(params.tags),
      ...builtSteps.impliedTags,
    ]);
    const spec: WorkflowSpec = {
      workflowId,
      name,
      goal,
      topology,
      ...(params.description?.trim() ? { description: params.description.trim() } : {}),
      ...(params.sourceSummary?.trim() ? { sourceSummary: params.sourceSummary.trim() } : {}),
      ...(params.workspaceDir?.trim() ? { sourceWorkspaceDir: params.workspaceDir.trim() } : {}),
      ...(params.agentDir?.trim() ? { sourceAgentDir: params.agentDir.trim() } : {}),
      tags: specTags,
      inputs: buildFieldSpecs(params.inputs),
      outputs: buildFieldSpecs(params.outputs),
      steps: builtSteps.steps,
      ...(params.sessionKey?.trim() ? { sourceSessionKey: params.sessionKey.trim() } : {}),
      ...(params.sessionId?.trim() ? { sourceSessionId: params.sessionId.trim() } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const entry: WorkflowRegistryEntry = {
      workflowId,
      name,
      ...(params.description?.trim() ? { description: params.description.trim() } : {}),
      ...(params.sessionKey?.trim() ? { ownerSessionKey: params.sessionKey.trim() } : {}),
      ...(params.sessionId?.trim() ? { ownerSessionId: params.sessionId.trim() } : {}),
      scope: params.workspaceDir?.trim() ? "workspace" : "session",
      target: "n8n",
      enabled: true,
      safeForAutoRun: params.safeForAutoRun === true,
      requiresApproval:
        params.requiresApproval !== undefined
          ? params.requiresApproval
          : builtSteps.inferredRequiresApproval !== false,
      tags: specTags,
      specVersion: 1,
      deploymentVersion: 0,
      deploymentState: "draft",
      createdAt: now,
      updatedAt: now,
    };

    store.workflows.push(entry);
    await api.saveSpecVersion(buildWorkflowSnapshot(entry, spec, "create", params.sessionKey));
    await api.saveSpec(spec);
    await api.saveRegistryStore(store);

    return {
      entry,
      spec,
      storeRoot: api.root,
      specPath: resolveWorkflowSpecPath(params, workflowId),
    };
  });
}

export async function listWorkflows(
  context: WorkflowStoreContext,
): Promise<WorkflowRegistryEntry[]> {
  const store = await loadWorkflowRegistryStore(context);
  return [...store.workflows].toSorted((a, b) => b.updatedAt - a.updatedAt);
}

export async function describeWorkflow(
  context: WorkflowStoreContext,
  ref: string,
): Promise<{
  entry: WorkflowRegistryEntry;
  spec: WorkflowSpec | null;
  storeRoot: string;
  specPath: string;
} | null> {
  const store = await loadWorkflowRegistryStore(context);
  const entry = findWorkflowEntry(store, ref);
  if (!entry) {
    return null;
  }
  return {
    entry,
    spec: await loadWorkflowSpec(context, entry.workflowId),
    storeRoot: requireWorkflowRoot(context),
    specPath: resolveWorkflowSpecPath(context, entry.workflowId),
  };
}

export async function listWorkflowVersions(
  context: WorkflowStoreContext,
  ref: string,
): Promise<{
  entry: WorkflowRegistryEntry;
  specVersions: WorkflowVersionSnapshot[];
  deployments: WorkflowDeploymentRecord[];
  currentDeployment: WorkflowDeploymentRecord | null;
} | null> {
  const described = await describeWorkflow(context, ref);
  if (!described) {
    return null;
  }
  const specVersions = await listWorkflowVersionSnapshots(context, described.entry.workflowId);
  const currentDeployment = await getCurrentWorkflowDeployment(context, described.entry);
  return {
    entry: described.entry,
    specVersions,
    deployments: await listWorkflowDeployments(context, described.entry.workflowId),
    currentDeployment,
  };
}

export async function updateWorkflowDefinition(
  context: WorkflowStoreContext & { sessionKey?: string },
  ref: string,
  patch: WorkflowDefinitionPatch,
): Promise<{ entry: WorkflowRegistryEntry; spec: WorkflowSpec } | null> {
  return await withWorkflowStoreMutation(context, async (api) => {
    const store = await api.loadRegistryStore();
    const entry = findWorkflowEntry(store, ref);
    if (!entry) {
      return null;
    }
    const spec = await api.loadSpec(entry.workflowId);
    if (!spec) {
      throw new Error(`Workflow spec for "${entry.workflowId}" is missing.`);
    }
    const now = Date.now();
    const nextSpecVersion = entry.specVersion + 1;
    const updated = applyWorkflowDefinitionPatch({
      spec,
      entry,
      patch,
      specVersion: nextSpecVersion,
      updatedAt: now,
    });
    Object.assign(entry, updated.entry);
    const duplicate = store.workflows.find(
      (candidate) =>
        candidate.workflowId !== entry.workflowId &&
        candidate.name.trim().toLowerCase() === updated.entry.name.trim().toLowerCase(),
    );
    if (duplicate) {
      throw new Error(`Workflow "${updated.entry.name}" already exists.`);
    }
    await api.saveSpec(updated.spec);
    await api.saveSpecVersion(
      buildWorkflowSnapshot(entry, updated.spec, "update", context.sessionKey),
    );
    await api.saveRegistryStore(store);
    return {
      entry,
      spec: updated.spec,
    };
  });
}

export async function rollbackWorkflowDefinition(
  context: WorkflowStoreContext & { sessionKey?: string },
  ref: string,
  targetSpecVersion: number,
): Promise<{
  entry: WorkflowRegistryEntry;
  spec: WorkflowSpec;
  restoredFromSpecVersion: number;
} | null> {
  return await withWorkflowStoreMutation(context, async (api) => {
    const store = await api.loadRegistryStore();
    const entry = findWorkflowEntry(store, ref);
    if (!entry) {
      return null;
    }
    const snapshot = await api.loadSpecVersion(entry.workflowId, targetSpecVersion);
    if (!snapshot) {
      throw new Error(
        `Workflow "${entry.workflowId}" does not have spec version ${targetSpecVersion}.`,
      );
    }
    const now = Date.now();
    const nextSpecVersion = entry.specVersion + 1;
    const restoredSpec: WorkflowSpec = {
      ...snapshot.spec,
      workflowId: entry.workflowId,
      createdAt: snapshot.spec.createdAt,
      updatedAt: now,
    };
    const duplicate = store.workflows.find(
      (candidate) =>
        candidate.workflowId !== entry.workflowId &&
        candidate.name.trim().toLowerCase() === restoredSpec.name.trim().toLowerCase(),
    );
    if (duplicate) {
      throw new Error(`Workflow "${restoredSpec.name}" already exists.`);
    }
    entry.name = restoredSpec.name;
    entry.description = snapshot.policy.description;
    entry.tags = [...snapshot.policy.tags];
    entry.enabled = snapshot.policy.enabled;
    entry.safeForAutoRun = snapshot.policy.safeForAutoRun;
    entry.requiresApproval = snapshot.policy.requiresApproval;
    entry.archivedAt = snapshot.policy.archivedAt;
    entry.specVersion = nextSpecVersion;
    entry.deploymentState = entry.deploymentVersion > 0 ? "draft" : entry.deploymentState;
    entry.updatedAt = now;
    await api.saveSpec(restoredSpec);
    await api.saveSpecVersion(
      buildWorkflowVersionSnapshot({
        specVersion: nextSpecVersion,
        reason: `rollback:${targetSpecVersion}`,
        savedBySessionKey: context.sessionKey,
        spec: restoredSpec,
        entry,
      }),
    );
    await api.saveRegistryStore(store);
    return {
      entry,
      spec: restoredSpec,
      restoredFromSpecVersion: targetSpecVersion,
    };
  });
}

function scoreMatch(entry: WorkflowRegistryEntry, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) {
    return 0;
  }
  let score = 0;
  const name = entry.name.toLowerCase();
  const description = entry.description?.toLowerCase() ?? "";
  const tags = entry.tags.map((tag) => tag.toLowerCase());
  if (name === q) {
    score += 100;
  }
  if (name.includes(q)) {
    score += 50;
  }
  if (description.includes(q)) {
    score += 20;
  }
  for (const tag of tags) {
    if (tag === q) {
      score += 20;
    } else if (tag.includes(q)) {
      score += 10;
    }
  }
  for (const term of q.split(/\s+/).filter(Boolean)) {
    if (name.includes(term)) {
      score += 8;
    }
    if (description.includes(term)) {
      score += 4;
    }
    if (tags.some((tag) => tag.includes(term))) {
      score += 2;
    }
  }
  return score;
}

export async function matchWorkflows(
  context: WorkflowStoreContext,
  query: string,
  opts?: {
    limit?: number;
    enabledOnly?: boolean;
    deployedOnly?: boolean;
    autoRunnableOnly?: boolean;
  },
): Promise<Array<WorkflowRegistryEntry & { matchScore: number }>> {
  const store = await loadWorkflowRegistryStore(context);
  const limit = Math.max(1, opts?.limit ?? 5);
  return store.workflows
    .map((entry) => ({ ...entry, matchScore: scoreMatch(entry, query) }))
    .filter((entry) => entry.matchScore > 0)
    .filter((entry) => (opts?.enabledOnly ? entry.enabled : true))
    .filter((entry) => (opts?.deployedOnly ? entry.deploymentState === "deployed" : true))
    .filter((entry) => (opts?.autoRunnableOnly ? deriveInvocationHint(entry).autoRunnable : true))
    .toSorted((a, b) => b.matchScore - a.matchScore || b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

export function getWorkflowInvocationHint(entry: WorkflowRegistryEntry): WorkflowInvocationHint {
  return deriveInvocationHint(entry);
}

export async function setWorkflowEnabled(
  context: WorkflowStoreContext,
  ref: string,
  enabled: boolean,
): Promise<WorkflowRegistryEntry | null> {
  return await mutateWorkflowRegistryStore(context, async (store) => {
    const entry = findWorkflowEntry(store, ref);
    if (!entry) {
      return null;
    }
    entry.enabled = enabled;
    entry.updatedAt = Date.now();
    return entry;
  });
}

export async function setWorkflowArchived(
  context: WorkflowStoreContext,
  ref: string,
  archived: boolean,
): Promise<WorkflowRegistryEntry | null> {
  return await mutateWorkflowRegistryStore(context, async (store) => {
    const entry = findWorkflowEntry(store, ref);
    if (!entry) {
      return null;
    }
    entry.archivedAt = archived ? Date.now() : undefined;
    if (archived) {
      entry.enabled = false;
    }
    entry.updatedAt = Date.now();
    return entry;
  });
}

export async function deleteWorkflow(
  context: WorkflowStoreContext,
  ref: string,
): Promise<{ deleted: boolean; workflowId?: string; removedExecutions?: number }> {
  return await withWorkflowStoreMutation(context, async (api) => {
    const store = await api.loadRegistryStore();
    const entry = findWorkflowEntry(store, ref);
    if (!entry) {
      return { deleted: false };
    }
    store.workflows = store.workflows.filter(
      (candidate) => candidate.workflowId !== entry.workflowId,
    );
    await api.saveRegistryStore(store);
    await api.deleteSpec(entry.workflowId);
    const executionStore = await api.loadExecutionStore();
    const before = executionStore.executions.length;
    executionStore.executions = executionStore.executions.filter(
      (candidate) => candidate.workflowId !== entry.workflowId,
    );
    const removedExecutions = before - executionStore.executions.length;
    if (removedExecutions > 0) {
      await api.saveExecutionStore(executionStore);
    }
    const deploymentStore = await api.loadDeploymentStore();
    deploymentStore.deployments = deploymentStore.deployments.filter(
      (record) => record.workflowId !== entry.workflowId,
    );
    await api.saveDeploymentStore(deploymentStore);
    await api.deleteSpecVersions(entry.workflowId);
    return {
      deleted: true,
      workflowId: entry.workflowId,
      removedExecutions,
    };
  });
}

export async function markWorkflowDeployed(
  context: WorkflowStoreContext,
  ref: string,
  params: {
    n8nWorkflowId: string;
    deploymentVersion?: number;
    specVersion?: number;
    publishedBySessionKey?: string;
    summary?: string;
  },
): Promise<WorkflowRegistryEntry | null> {
  return await withWorkflowStoreMutation(context, async (api) => {
    const store = await api.loadRegistryStore();
    const entry = findWorkflowEntry(store, ref);
    if (!entry) {
      return null;
    }
    const nextDeploymentVersion =
      params.deploymentVersion ?? Math.max(1, entry.deploymentVersion + 1);
    entry.n8nWorkflowId = params.n8nWorkflowId;
    entry.deploymentState = "deployed";
    entry.deploymentVersion = nextDeploymentVersion;
    entry.updatedAt = Date.now();
    const deploymentStore = await api.loadDeploymentStore();
    const record: WorkflowDeploymentRecord = {
      workflowId: entry.workflowId,
      deploymentVersion: nextDeploymentVersion,
      specVersion: params.specVersion ?? entry.specVersion,
      n8nWorkflowId: params.n8nWorkflowId,
      publishedAt: entry.updatedAt,
      ...(params.publishedBySessionKey?.trim()
        ? { publishedBySessionKey: params.publishedBySessionKey.trim() }
        : {}),
      ...(params.summary?.trim() ? { summary: params.summary.trim() } : {}),
    };
    deploymentStore.deployments = deploymentStore.deployments.filter(
      (existing) =>
        !(
          existing.workflowId === record.workflowId &&
          existing.deploymentVersion === record.deploymentVersion
        ),
    );
    deploymentStore.deployments.push(record);
    await api.saveDeploymentStore(deploymentStore);
    await api.saveRegistryStore(store);
    return entry;
  });
}

export async function touchWorkflowRun(
  context: WorkflowStoreContext,
  ref: string,
): Promise<WorkflowRegistryEntry | null> {
  return await mutateWorkflowRegistryStore(context, async (store) => {
    const entry = findWorkflowEntry(store, ref);
    if (!entry) {
      return null;
    }
    const now = Date.now();
    entry.lastRunAt = now;
    entry.updatedAt = now;
    return entry;
  });
}
